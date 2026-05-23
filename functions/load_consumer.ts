// Scenario 4 (consumer) — Demo of Lambda scaling, retries, and
// partial-batch failure (ReportBatchItemFailures).
//
// This new AWS account's total Lambda concurrency is capped at 10
// (below the documented 1000 default), so the ACCOUNT QUOTA itself
// becomes the visible throttle.  No ReservedConcurrentExecutions
// needed — the queue will rate-limit naturally.  Watch CloudWatch:
//     · ConcurrentExecutions  — sits at the account ceiling
//     · Throttles             — non-zero while the queue is hot
//     · Invocations           — climbs ≈ count / batchSize
//     · NumberOfMessagesVisible (LoadQueue) — rises, then drains
//     · ApproximateNumberOfMessagesVisible (LoadDlq) — climbs to ~count/10
//
// Every 10th message (n % 10 === 0) intentionally fails.  We DO NOT
// throw — that would fail the whole batch.  Instead we return the bad
// messageIds inside `batchItemFailures`, so SQS retries ONLY those
// nine wrong-ones, while the other 9 of each batch are deleted.
//
// After 3 receives (maxReceiveCount on the queue) the bad messages
// move to LoadDlq.  CloudWatch Logs Insights query to count failures:
//
//     fields @timestamp, @message
//     | filter @message like /INTENTIONAL_FAILURE/
//     | stats count() as failures by bin(30s)

import { SQSEvent, SQSBatchResponse } from 'aws-lambda';

interface MessageBody {
    n: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    const batchSize = event.Records.length;

    console.log(
        JSON.stringify({
            kind: 'batch_received',
            batchSize,
            firstMessageId: event.Records[0]?.messageId,
        })
    );

    for (const record of event.Records) {
        const attempt =
            Number(record.attributes?.ApproximateReceiveCount ?? '1');

        let body: MessageBody;
        try {
            body = JSON.parse(record.body) as MessageBody;
        } catch (err) {
            console.error(
                JSON.stringify({
                    kind: 'parse_failure',
                    messageId: record.messageId,
                    error: (err as Error).message,
                })
            );
            batchItemFailures.push({ itemIdentifier: record.messageId });
            continue;
        }

        // Pretend each message takes a little work.  Keeps queue depth
        // visible in CloudWatch while still draining at a reasonable pace.
        await sleep(50);

        // Intentional failure: every 10th message.
        if (body.n % 10 === 0) {
            console.error(
                JSON.stringify({
                    kind: 'INTENTIONAL_FAILURE',
                    messageId: record.messageId,
                    n: body.n,
                    attempt,
                    note:
                        attempt >= 3
                            ? 'final attempt — will move to DLQ'
                            : 'will be retried',
                })
            );
            batchItemFailures.push({ itemIdentifier: record.messageId });
            continue;
        }

        console.log(
            JSON.stringify({
                kind: 'processed',
                messageId: record.messageId,
                n: body.n,
                attempt,
            })
        );
    }

    if (batchItemFailures.length > 0) {
        console.log(
            JSON.stringify({
                kind: 'batch_partial_failure',
                batchSize,
                failed: batchItemFailures.length,
                succeeded: batchSize - batchItemFailures.length,
            })
        );
    }

    // Return the failed messageIds so SQS retries ONLY those.  The
    // others are deleted automatically.
    return { batchItemFailures };
}
