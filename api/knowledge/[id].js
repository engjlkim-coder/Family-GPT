import {client,getVectorStoreId} from "../_vectorStore.js";
export default async function handler(req,res){
 if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY 환경변수가 없습니다."});
 if(req.method!=="DELETE")return res.status(405).json({error:"DELETE only"});
 try{const vs=await getVectorStoreId(),id=req.query?.id;if(!id)return res.status(400).json({error:"파일 ID가 없습니다."});await client.vectorStores.files.delete(id,{vector_store_id:vs});try{await client.files.delete(id)}catch{}return res.status(200).json({ok:true})}catch(e){return res.status(500).json({error:e?.message||"지식자료 삭제 오류"})}
}