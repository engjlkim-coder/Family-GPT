import OpenAI from "openai";
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const AUTO_NAME=process.env.VECTOR_STORE_NAME||"family-gpt-pwa-knowledge";
let cachedVectorStoreId=process.env.VECTOR_STORE_ID||null;
export async function getVectorStoreId(){
 if(!process.env.OPENAI_API_KEY)throw new Error("OPENAI_API_KEY 환경변수가 없습니다.");
 if(cachedVectorStoreId)return cachedVectorStoreId;
 const list=await client.vectorStores.list({limit:100});
 const found=(list.data||[]).find(v=>v.name===AUTO_NAME);
 if(found?.id){cachedVectorStoreId=found.id;return cachedVectorStoreId;}
 const created=await client.vectorStores.create({name:AUTO_NAME,metadata:{app:"family-gpt-pwa",version:"3.3"}});
 cachedVectorStoreId=created.id;return cachedVectorStoreId;
}
export {client};
