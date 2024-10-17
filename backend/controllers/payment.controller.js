import Coupon from "../models/coupon.model.js";
import {stripe} from "../lib/stripe.js";
import Order from "../models/order.model.js";
export const createCheckoutSession =  async (req, res) => {
    try {
        const{product, couponCode} = req.body;    

        if(!Array.isArray(product)|| product.length === 0){
            return res.status(400).json({message:"Invalid or empty  products array"});
        }

        let totalAmount=0;

        const lineItems = product.map((product)=>{
            const amount = Math.round(product.price * 100); // stripe bizden cent bazında istediği için 100 ile carpıyoruz.
            totalAmount+=amount *product.quantity;
            
            return {
                price_data:{
                    currency:"usd",
                    product_data:{
                        name:product.name,
                        image:[product.image]
                    },
                unitAmount:amount
                }
            }
        });

        let coupon=null;
        if(couponCode){
           coupon=await Coupon.findOne({code:couponCode, userId:req.user._id,isActive:true});
           if(coupon){
           totalAmount-=Math.round(totalAmount*coupon.discountPercentage/100);
        }
    } 

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card",],
        line_items: lineItems,
        mode:"payment",
        success_url:`${process.env.CLIENT_URL}/purchase-success?session_id={CHECKOUT_SESSION_ID}`,       
        cancel_url:`${process.env.CLIENT_URL}/purchase-cancel`,
        discounts:coupon
            ?[{coupon:await createStripeCoupon(coupon.discountPercentage)}]:[],
            metadata:{
                userId:req.user._id.toString(),
                couponCode:couponCode || "",
                product: JSON.stringify(
                    product.map((p) => ({
                        id: p._id,
                        quantity: p.quantity,
                        price: p.price,
                    })
                ))
            }
        

       
    });
    if(totalAmount>=20000){
        await createNewCoupon(req.user._id);
    }
    res.status(200).json({id:session.id, totalAmount:totalAmount/100})
}catch (error) {
        console.error("Error in createCheckoutSession ",error);
        res.status(500).json({message:"Server error",error:error.message});
    }
 }
 async function createStripeCoupon(discountPercentage){
    const coupon = await stripe.coupons.create({
        percent_off:discountPercentage,
        duration:"once",
    });
    return coupon.id;
}   

async function createNewCoupon(userId){
    const newCoupon=new Coupon({
        code:"GIFT"+Math.random().toString(36).substring(2,8).toUpperCase(),
        discountPercentage:10,
        expirationDate:new Date(),
        userId:userId
    })
    await newCoupon.save();
    return newCoupon;
}
export const checkoutSuccess = async (req, res) => {
    try {
        const{sessionId}=req.body;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if(session.payment_status === "paid"){
            if(session.metadata.couponCode){
                await Coupon.findOneAndUpdate({code:session.metadata.couponCode},
                    {userId:session.metadata.userId},
                    {isActive:false},
                );
            }

        }
        const products = JSON.parse(session.metadata.product);
        const newOrder = new Order({
            user:session.metadata.userId,
            products:products.map(product=>({
                product:product.id,
                quantity:product.quantity,
                price:product.price
            })),
            totalAmount:session.amount_total/100,
            stripeSessionId:sessionId
        })
        await newOrder.save();
        res.status(200).json({
            succsess:true,
            message:"Odeme basarili siparis yaratildi ve Kupon kullanildiysa devre disi",
            orderId:newOrder._id,
        });
    } catch (error) {
        console.error("Error in getCheckoutSession ",error);
        res.status(500).json({message:"Server error",error:error.message});
    }
}
