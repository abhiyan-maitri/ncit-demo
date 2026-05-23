// Scenario 3 (stage 1) — Splitter
//
// Trigger: OcrQueue (S3 ObjectCreated events for incoming/*).
//
// For a PDF:
//   - Open it with pdfjs-dist, count the pages
//   - Fan-out one SQS message PER PAGE to OcrPageQueue:
//       { bucket, key, page, totalPages, padDigits }
// For an image:
//   - Forward one message to OcrPageQueue:
//       { bucket, key }
//
// The page worker then runs concurrently across all pages, so a
// 49-page PDF processes in ~5 batches (≈ account concurrency cap)
// instead of sequentially.  Classic slide-10 delegation pattern.

const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const {
  S3Client,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const {
  SQSClient,
  SendMessageBatchCommand,
} = require("@aws-sdk/client-sqs");

const s3 = new S3Client({});
const sqs = new SQSClient({});
const PAGE_QUEUE_URL = process.env.PAGE_QUEUE_URL;

try {
  pdfjs.GlobalWorkerOptions.workerSrc = false;
} catch (_) {
  /* noop */
}

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const enqueuePageMessages = async (bucket, key, pageCount) => {
  const padDigits = String(pageCount).length < 4 ? 4 : String(pageCount).length;
  for (let start = 1; start <= pageCount; start += 10) {
    const entries = [];
    for (let j = 0; j < 10 && start + j <= pageCount; j++) {
      const page = start + j;
      entries.push({
        Id: String(j),
        MessageBody: JSON.stringify({
          bucket,
          key,
          page,
          totalPages: pageCount,
          padDigits,
        }),
      });
    }
    await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: PAGE_QUEUE_URL,
        Entries: entries,
      })
    );
  }
};

const enqueueImageMessage = (bucket, key) =>
  sqs.send(
    new SendMessageBatchCommand({
      QueueUrl: PAGE_QUEUE_URL,
      Entries: [
        {
          Id: "0",
          MessageBody: JSON.stringify({ bucket, key }),
        },
      ],
    })
  );

const splitPdf = async (bucket, key) => {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buf = await streamToBuffer(obj.Body);
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;
  const pageCount = pdf.numPages;
  await pdf.destroy();

  await enqueuePageMessages(bucket, key, pageCount);
  return pageCount;
};

exports.handler = async (event) => {
  let pagesEnqueued = 0;
  let imagesEnqueued = 0;

  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    for (const s3Record of body.Records || []) {
      const bucket = s3Record.s3.bucket.name;
      const key = decodeURIComponent(
        s3Record.s3.object.key.replace(/\+/g, " ")
      );

      if (/\.pdf$/i.test(key)) {
        const count = await splitPdf(bucket, key);
        pagesEnqueued += count;
        console.log(
          `splitter PDF  src=s3://${bucket}/${key}  pages=${count}  fanned-out`
        );
      } else if (/\.(png|jpe?g|tiff?|bmp|webp)$/i.test(key)) {
        await enqueueImageMessage(bucket, key);
        imagesEnqueued++;
        console.log(`splitter image  src=s3://${bucket}/${key}  forwarded`);
      } else {
        console.warn(`splitter SKIP  unsupported file: s3://${bucket}/${key}`);
      }
    }
  }

  return { pagesEnqueued, imagesEnqueued };
};
