import OpenAI from "openai";
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"POST only"});
 if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY 환경변수가 없습니다."});
 try{
  const {model,question,history=[],images=[]}=req.body||{};
  const safeImages=Array.isArray(images)?images.filter(x=>typeof x==="string"&&x.startsWith("data:image/")).slice(0,4):[];
  const content=[{type:"input_text",text:question||"첨부 이미지를 분석해 주세요."},...safeImages.map(x=>({type:"input_image",image_url:x,detail:"high"}))];
  const input=[{role:"developer",content:[{type:"input_text",text:"개인용 AI 비서입니다. 등록된 지식자료가 있으면 file search 결과를 우선 사용하세요. 파일에서 확인되지 않는 내용은 파일에서 확인했다고 말하지 마세요. 이미지가 있으면 실제 이미지 내용을 관찰하여 답하세요."}]},...(Array.isArray(history)?history.slice(-10):[]).filter(x=>x&&(x.role==="user"||x.role==="assistant")).map(x=>({role:x.role,content:[{type:"input_text",text:String(x.content||"")}]})),{role:"user",content}];
  const params={model:model||"gpt-5.6",input};
  if(process.env.VECTOR_STORE_ID)params.tools=[{type:"file_search",vector_store_ids:[process.env.VECTOR_STORE_ID],max_num_results:8}];
  const response=await client.responses.create(params);
  return res.status(200).json({answer:response.output_text||"응답이 없습니다."});
 }catch(e){console.error(e);return res.status(500).json({error:e?.message||"OpenAI API 오류"});}
}
