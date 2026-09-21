import OpenAI from "openai";
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
export default async function handler(req,res){
 const vs=process.env.VECTOR_STORE_ID,id=req.query?.id;
 if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY 환경변수가 없습니다."});
 if(!vs)return res.status(500).json({error:"VECTOR_STORE_ID 환경변수가 없습니다."});
 if(req.method!=="DELETE")return res.status(405).json({error:"DELETE only"});
 try{await client.vectorStores.files.delete(id,{vector_store_id:vs});try{await client.files.delete(id);}catch{}return res.status(200).json({ok:true});}
 catch(e){console.error(e);return res.status(500).json({error:e?.message||"지식자료 삭제 오류"});}
}
