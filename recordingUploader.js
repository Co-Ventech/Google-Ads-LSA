const axios = require('axios');
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  S3_RECORDINGS_BUCKET
} = process.env;

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
  }
});

function buildPublicUrl(bucket, region, key) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

async function uploadRecordingToS3({ recordingUrl, callId }) {
  const downloadResponse = await axios.get(recordingUrl, {
    responseType: 'stream',
    timeout: 60000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });

  const key = `${callId}.mp3`;

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: S3_RECORDINGS_BUCKET,
      Key: key,
      Body: downloadResponse.data,
      ContentType: 'audio/mpeg'
    }
  });

  await upload.done();

  return {
    s3Url: buildPublicUrl(S3_RECORDINGS_BUCKET, AWS_REGION, key),
    bucket: S3_RECORDINGS_BUCKET,
    key
  };
}

async function handleUploadRecording(req, res) {
  const body = req.body || {};
  const event = body.event;
  const data = body.data || {};
  const callId = data.id;
  const recordingUrl = data.recording;

  console.log(`\n📞 /upload-recording hit | event=${event} call_id=${callId}`);

  if (event && event !== 'call.ended') {
    console.log(`   ⏭️  Skipped: event is "${event}", not "call.ended"`);
    return res.status(200).json({ skipped: true, reason: `event ${event} ignored` });
  }

  if (!callId) {
    console.log('   ❌ Missing data.id in payload');
    return res.status(400).json({ error: 'Missing data.id in payload' });
  }

  if (!recordingUrl) {
    console.log(`   ⏭️  Skipped: no recording URL for call ${callId}`);
    return res.status(200).json({ skipped: true, reason: 'no recording on this call' });
  }

  try {
    const startedAt = Date.now();
    const result = await uploadRecordingToS3({ recordingUrl, callId });
    const elapsedMs = Date.now() - startedAt;

    console.log(`   ✅ Uploaded to S3 in ${elapsedMs}ms → ${result.s3Url}`);

    return res.status(200).json({
      success: true,
      s3_url: result.s3Url,
      bucket: result.bucket,
      key: result.key,
      call_id: callId
    });
  } catch (err) {
    const isDownloadError = err.config && err.config.url === recordingUrl;
    const status = isDownloadError ? 502 : 500;
    const stage = isDownloadError ? 'download_from_aircall' : 's3_upload';

    console.error(`   ❌ Failed at ${stage}:`, err.response?.status || '', err.message);

    return res.status(status).json({
      success: false,
      stage,
      error: err.message,
      call_id: callId
    });
  }
}

module.exports = {
  handleUploadRecording,
  uploadRecordingToS3
};
