import OpenAI,{toFile} from "openai";
import Busboy from "busboy";
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
export const config={api:{bodyParser:false}};
function parseMultipart(req){return new Promise((resolve,reject)=>{const bb=Busboy({headers:req.headers,limits:{files:1,fileSize:3*1024*1024}});let filename="file",mimeType="application/octet-stream";const chunks=[];let tooLarge=false;bb.on("file",(_field,file,info)=>{filename=info.filename||filename;mimeType=info.mimeType||mimeType;file.on("data",d=>chunks.push(d));file.on("limit",()=>{tooLarge=true});});bb.on("finish",()=>{if(tooLarge)return reject(new Error("파일은 3MB 이하로 올려주세요. Vercel Functions의 요청 크기 제한 때문입니다."));resolve({filename,mimeType,buffer:Buffer.concat(chunks)});});bb.on("error",reject);req.pipe(bb);});}
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"POST only"});
 if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY 환경변수가 없습니다."});
 if(!process.env.VECTOR_STORE_ID)return res.status(500).json({error:"VECTOR_STORE_ID 환경변수가 없습니다."});
 try{const {filename,mimeType,buffer}=await parseMultipart(req);if(!buffer?.length)return res.status(400).json({error:"파일을 찾지 못했습니다."});const uploadable=await toFile(buffer,filename,{type:mimeType});const result=await client.vectorStores.files.uploadAndPoll(process.env.VECTOR_STORE_ID,uploadable,{pollIntervalMs:1000});if(result.status!=="completed")return res.status(400).json({error:result.last_error?.message||`파일 처리 상태: ${result.status}`});return res.status(200).json({ok:true,id:result.id,filename,status:result.status});}
 catch(e){console.error(e);return res.status(500).json({error:e?.message||"파일 업로드 오류"});}
}
