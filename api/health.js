import { put, del } from '@vercel/blob';

export default async function handler(req, res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Access-Control-Allow-Origin','*');

  const hasBlobToken = !!process.env.BLOB_READ_WRITE_TOKEN;

  try{
    if(!hasBlobToken){
      return res.status(500).json({
        ok:false,
        hasBlobToken:false,
        writeTest:false,
        error:'Missing BLOB_READ_WRITE_TOKEN. Connect a Vercel Blob store to this project and redeploy.'
      });
    }

    const pathname = `health/health-${Date.now()}.json`;
    const blob = await put(pathname, JSON.stringify({ok:true, at:new Date().toISOString()}), {
      access:'public',
      contentType:'application/json',
      allowOverwrite:true
    });

    try{ await del(blob.pathname || pathname); }catch(e){}

    return res.status(200).json({
      ok:true,
      hasBlobToken:true,
      writeTest:true,
      at:new Date().toISOString()
    });
  }catch(error){
    return res.status(500).json({
      ok:false,
      hasBlobToken,
      writeTest:false,
      error:error.message
    });
  }
}
