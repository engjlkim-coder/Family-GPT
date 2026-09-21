import OpenAI from "openai";
import Busboy from "busboy";
import {Readable} from "stream";
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});

export const config={api:{bodyParser:false}};

function parse(req){
 return new Promise((resolve,reject)=>{
  const bb=Busboy({headers:req.headers});
  let filename="file";let chunks=[];
  bb.on("file",(name,file,info)=>{filename=info.filename;file.on("data",d=>chunks.push(d));});
  bb.on("finish",()=>resolve({filename,buffer:Buffer.concat(chunks)}));
  bb.on("error",reject);req.pipe(bb);
 });
}
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"POST only"});
 if(!process.env.VECTOR_STORE_ID)return res.status(500).json({error:"VECTOR_STORE_ID 환경변수가 없습니다."});
 try{
  const {filename,buffer}=await parse(req);
  const file=await client.files.create({file:new File([buffer],filename),purpose:"assistants"});
  await client.vectorStores.files.create(process.env.VECTOR_STORE_ID,{file_id:file.id});
  return res.status(200).json({ok:true,id:file.id,filename});
 }catch(e){return res.status(500).json({error:e.message})}
}