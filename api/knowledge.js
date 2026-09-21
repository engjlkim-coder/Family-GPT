import OpenAI from "openai";
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
export default async function handler(req,res){
 const vs=process.env.VECTOR_STORE_ID;
 if(!vs)return res.status(500).json({error:"VECTOR_STORE_ID 환경변수가 없습니다."});
 try{
  if(req.method==="GET"){
   const list=await client.vectorStores.files.list(vs,{limit:100});
   const files=[];
   for(const x of list.data||[]){let filename=x.id;try{const f=await client.files.retrieve(x.id);filename=f.filename||filename}catch{}files.push({id:x.id,filename,status:x.status})}
   return res.status(200).json({files});
  }
  return res.status(405).json({error:"GET only"});
 }catch(e){return res.status(500).json({error:e.message})}
}