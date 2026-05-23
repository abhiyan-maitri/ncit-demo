// Scenario 3 (stage 2) — Page worker
//
// Trigger: OcrPageQueue.  Each message is either:
//   { bucket, key, page, totalPages, padDigits }    ← a PDF page
//   { bucket, key }                                  ← a whole image
//
// For PDFs: extract the embedded text for that ONE page.
// For images: run tesseract.js OCR.
//
// Output:
//   extracted/<base>/page-NNNN.txt    (PDF)
//   extracted/<base>.txt              (image)
//
// AWS scales this Lambda concurrently up to the account cap.
// With 49 PDF pages and ~10 concurrent invocations, a job that
// would have taken ~25s sequentially finishes in ~3s.

const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const { createWorker } = require("tesseract.js");
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME;

try {
  pdfjs.GlobalWorkerOptions.workerSrc = false;
} catch (_) {
  /* noop */
}

// Tesseract worker — created lazily, only when an image arrives.
let workerPromise;
const getTesseractWorker = () => {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      cachePath: "/tmp",
      logger: () => {},
    });
  }
  return workerPromise;
};

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const writeOut = (key, body) =>
  s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "text/plain; charset=utf-8",
    })
  );

const handlePdfPage = async ({ bucket, key, page, padDigits }) => {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buf = await streamToBuffer(obj.Body);
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;

  const pageObj = await pdf.getPage(page);
  const content = await pageObj.getTextContent();
  const text = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  await pageObj.cleanup();
  await pdf.destroy();

  const baseKey = key
    .replace(/^incoming\//, "extracted/")
    .replace(/\.pdf$/i, "");
  const pad = padDigits || 4;
  const outKey = `${baseKey}/page-${String(page).padStart(pad, "0")}.txt`;
  await writeOut(outKey, text);

  console.log(
    `page worker PDF  src=s3://${bucket}/${key}  page=${page}  out=s3://${BUCKET}/${outKey}  chars=${text.length}`
  );
};

const handleImage = async ({ bucket, key }) => {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buf = await streamToBuffer(obj.Body);
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(buf);
  const text = data.text || "";

  const outKey = key
    .replace(/^incoming\//, "extracted/")
    .replace(/\.[^.]+$/, ".txt");
  await writeOut(outKey, text);

  console.log(
    `page worker image  src=s3://${bucket}/${key}  out=s3://${BUCKET}/${outKey}  chars=${text.length}`
  );
};

exports.handler = async (event) => {
  for (const record of event.Records) {
    const msg = JSON.parse(record.body);
    if (typeof msg.page === "number") {
      await handlePdfPage(msg);
    } else {
      await handleImage(msg);
    }
  }
  return { processed: event.Records.length };
};
