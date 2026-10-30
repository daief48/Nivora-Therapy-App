import fs from 'node:fs';
const key=(fs.readFileSync('.env','utf8').match(/^OPENAI_API_KEY=(.+)$/m)||[])[1];
const out='../voice-samples/';
const STYLE='a cute, sweet, cheerful young woman with a light, slightly higher, playful voice and a warm smile in her tone, like a friendly anime or storybook girl. Gentle and soft, never childish or squeaky.';
const CLARITY='Speak at a natural conversational pace and enunciate clearly.';
const texts={bn:'হ্যালো! আমি নিভোরা। আজ তোমার দিনটা কেমন কাটছে? আমি এখানে আছি, তুমি আমাকে সব বলতে পারো।',en:'Hi! I am Nivora. How is your day going? I am right here, so you can tell me anything.'};
const voices=['shimmer','coral','nova','sage','marin','ballad','verse'];
for (const v of voices) for (const [lang,input] of Object.entries(texts)) {
  const r=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini-tts',voice:v,input,instructions:`Voice: ${STYLE} ${lang==='bn'?'Speak Bangla as a native speaker from Dhaka.':'Speak clear natural English.'} ${CLARITY}`,response_format:'mp3'})});
  if(!r.ok){console.log(v,lang,'FAIL',r.status,(await r.text()).slice(0,90));continue;}
  const b=Buffer.from(await r.arrayBuffer()); fs.writeFileSync(`${out}cute-${v}-${lang}.mp3`,b); console.log(v,lang,'ok',Math.round(b.length/1024)+'KB');
}
