// Scenario 2 — Analyze S3 CSV data
// SQS delivers S3 ObjectCreated events. For each CSV in raw/ we write a
// tiny JSON summary to the matching reports/ key in the same bucket.

import { SQSEvent } from 'aws-lambda';
import { Readable } from 'node:stream';
import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
} from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME as string;

interface CsvReport {
    source_key: string;
    rows: number;
    columns: number;
    header: string[];
    sample: string[][];
}

const streamToString = async (stream: Readable): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf-8');
};

const parseCsv = (text: string): string[][] =>
    text
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => line.split(','));

const processCsv = async (bucket: string, key: string): Promise<void> => {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await streamToString(obj.Body as Readable);
    const rows = parseCsv(text);

    if (rows.length === 0) {
        console.log(`empty file: s3://${bucket}/${key}`);
        return;
    }

    const [header, ...data] = rows;
    const report: CsvReport = {
        source_key: key,
        rows: data.length,
        columns: header.length,
        header,
        sample: data.slice(0, 3),
    };

    const outKey = key.replace(/^raw\//, 'reports/').replace(/\.csv$/, '.json');

    await s3.send(
        new PutObjectCommand({
            Bucket: BUCKET,
            Key: outKey,
            Body: JSON.stringify(report, null, 2),
            ContentType: 'application/json',
        })
    );
    console.log(`report written  s3://${BUCKET}/${outKey}  (${data.length} rows)`);
};

export async function handler(event: SQSEvent): Promise<{ processed: number }> {
    for (const record of event.Records) {
        const body = JSON.parse(record.body);
        for (const s3Record of body.Records ?? []) {
            const bucket = s3Record.s3.bucket.name;
            const key = decodeURIComponent(
                s3Record.s3.object.key.replace(/\+/g, ' ')
            );
            await processCsv(bucket, key);
        }
    }
    return { processed: event.Records.length };
}
