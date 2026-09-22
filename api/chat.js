import {client,getVectorStoreId} from "./_vectorStore.js";

function buildUserContent(message) {
  const parts=[];
  if(message?.content) parts.push({type:"input_text",text:String(message.content)});
  for(const src of (Array.isArray(message?.images)?message.images:[]).slice(0,4)) {
    if(typeof src === "string" && src.startsWith("data:image/")) parts.push({type:"input_image",image_url:src,detail:"high"});
  }
  for(const file of (Array.isArray(message?.files)?message.files:[]).slice(0,4)) {
    if(file && typeof file.content === "string") {
      const name=String(file.name||"첨부파일");
      parts.push({type:"input_text",text:`\n[첨부 파일: ${name}]\n${file.content}\n[첨부 파일 끝]\n`});
    }
  }
  return parts.length ? parts : [{type:"input_text",text:""}];
}

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"POST only"});
  if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"OPENAI_API_KEY 환경변수가 없습니다."});
  try{
    const {model,question,history=[],images=[],files=[]}=req.body||{};
    const current={role:"user",content:question||"첨부한 자료를 분석해 주세요.",images,files};
    const input=[
      {role:"developer",content:[{type:"input_text",text:"개인용 AI 비서입니다. 등록된 지식자료가 있으면 file search 결과를 우선 사용하세요. 첨부 이미지와 파일의 실제 내용을 바탕으로 답하세요. 이전 대화에서 첨부된 이미지나 파일이 있으면 후속 질문에서도 그 자료를 계속 참조하세요. 파일에서 확인되지 않는 내용은 파일에서 확인했다고 말하지 마세요."}]},
      ...(Array.isArray(history)?history.slice(-12):[])
        .filter(x=>x&&(x.role==="user"||x.role==="assistant"))
        .map(x=>x.role==="assistant"
          ? {role:"assistant",content:[{type:"output_text",text:String(x.content||"")}]}
          : {role:"user",content:buildUserContent(x)}),
      {role:"user",content:buildUserContent(current)}
    ];
    const vectorStoreId=await getVectorStoreId();
    const response=await client.responses.create({
      model:model||"gpt-5.6",
      input,
      tools:[{type:"file_search",vector_store_ids:[vectorStoreId],max_num_results:8}]
    });
    return res.status(200).json({answer:response.output_text||"응답이 없습니다.",vector_store_id:vectorStoreId});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:e?.message||"OpenAI API 오류"});
  }
}
