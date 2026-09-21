import OpenAI from "openai";
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
export default async function handler(req,res){
 const vs=process.env.VECTOR_STORE_ID,id=req.query.id;
 if(!vs)return res.status(500).json({error:"VECTOR_STORE_ID 환경변수가 없습니다."});
 if(req.method!=="DELETE")return res.status(405).json({error:"DELETE only"});
 try{
  await client.vectorStores.files.del(vs,id);
  try{await client.files.del(id)}catch{}
  return res.status(200).json({ok:true});
 }catch(e){return res.status(500).json({error:e.message})}
}