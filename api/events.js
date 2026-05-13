import { list } from '@vercel/blob';

const PREFIX = 'sessions-v35/';

async function readJson(url){
  const res = await fetch(url, {cache:'no-store'});
  if(!res.ok) return null;
  return await res.json();
}

export default async function handler(req, res){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  try{
    const blobs = await list({prefix:PREFIX, limit:1000});
    const sessions = [];
    for(const b of blobs.blobs || []){
      try{
        const item = await readJson(b.url);
        if(item) sessions.push(item);
      }catch(e){}
    }
    const events = sessions.flatMap(s => (s.events || []));
    return res.status(200).json({
      ok:true,
      namespace:'sessions-v35',
      count:sessions.length,
      eventCount:events.length,
      blobCount:(blobs.blobs||[]).length,
      sessions,
      events,
      generatedAt:new Date().toISOString()
    });
  }catch(error){
    return res.status(500).json({ok:false, error:error.message, sessions:[], events:[]});
  }
}
