import {client,getVectorStoreId} from "./_vectorStore.js";
export default async function handler(req,res){
 if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY 환경변수가 없습니다."});
 if(req.method!=="GET")return res.status(405).json({error:"GET only"});
 try{const vs=await getVectorStoreId();const list=await client.vectorStores.files.list(vs,{limit:100,order:"desc"});const files=[];for(const x of list.data||[]){let filename=x.id;try{const f=await client.files.retrieve(x.id);filename=f.filename||filename}catch{}files.push({id:x.id,filename,status:x.status})}return res.status(200).json({files,vector_store_id:vs})}catch(e){return res.status(500).json({error:e?.message||"지식자료 조회 오류"})}
}