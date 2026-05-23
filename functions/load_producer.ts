// Scenario 4 (producer) — Fire N messages at the demo SQS queue.
//
// Invoke manually:
//   aws lambda invoke --function-name ncit-demo-load-producer \
//     --payload '{"count": 100000}' \
//     --cli-binary-format raw-in-base64-out /tmp/out.json
//
// SendMessageBatch can carry 10 messages per call, so 100,000 messages
// = 10,000 batch calls.  We fan out up to 50 batches concurrently to
// keep the producer fast (~30s for 100k messages on a 512MB Lambda).

import {
    SQSClient,
    SendMessageBatchCommand,
    SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});
const QUEUE_URL = process.env.QUEUE_URL as string;

const PARALLEL = 50;

interface ProducerInput {
    count?: number;
}

interface ProducerOutput {
    sent: number;
    durationMs: number;
}

export async function handler(event: ProducerInput): Promise<ProducerOutput> {
    const count = Math.max(1, Math.min(event?.count ?? 10000, 1_000_000));
    const started = Date.now();
    console.log(`producer starting count=${count} parallel=${PARALLEL}`);

    let sent = 0;
    let inFlight: Promise<unknown>[] = [];

    for (let i = 0; i < count; i += 10) {
        const entries: SendMessageBatchRequestEntry[] = [];
        for (let j = 0; j < 10 && i + j < count; j++) {
            const n = i + j;
            entries.push({
                Id: String(j),
                MessageBody: JSON.stringify({ n }),
            });
        }
        inFlight.push(
            sqs.send(
                new SendMessageBatchCommand({
                    QueueUrl: QUEUE_URL,
                    Entries: entries,
                })
            )
        );
        sent += entries.length;

        if (inFlight.length >= PARALLEL) {
            await Promise.all(inFlight);
            inFlight = [];
        }
    }
    await Promise.all(inFlight);

    const durationMs = Date.now() - started;
    console.log(`producer done sent=${sent} durationMs=${durationMs}`);
    return { sent, durationMs };
}
