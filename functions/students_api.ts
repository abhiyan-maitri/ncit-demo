// Scenario 1 — Simple REST API
//   POST   /students        body: { name, course }
//   GET    /students
//   GET    /students/{id}
//   DELETE /students/{id}

import { randomUUID } from 'node:crypto';
import {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    ScanCommand,
    DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME as string;

interface Student {
    id: string;
    name: string;
    course: string;
}

const respond = (statusCode: number, body: unknown = {}): APIGatewayProxyResultV2 => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

export async function handler(
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const params = event.pathParameters ?? {};

    try {
        if (method === 'POST' && path === '/students') {
            const body = JSON.parse(event.body ?? '{}');
            if (!body.name) return respond(400, { error: 'name is required' });

            const item: Student = {
                id: body.id ?? randomUUID(),
                name: body.name,
                course: body.course ?? '',
            };
            await ddb.send(
                new PutCommand({
                    TableName: TABLE,
                    Item: item,
                    ConditionExpression: 'attribute_not_exists(id)',
                })
            );
            return respond(201, item);
        }

        if (method === 'GET' && path === '/students') {
            const out = await ddb.send(new ScanCommand({ TableName: TABLE, Limit: 100 }));
            return respond(200, out.Items ?? []);
        }

        if (method === 'GET' && params.id) {
            const out = await ddb.send(
                new GetCommand({ TableName: TABLE, Key: { id: params.id } })
            );
            return out.Item ? respond(200, out.Item) : respond(404, { error: 'not found' });
        }

        if (method === 'DELETE' && params.id) {
            await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id: params.id } }));
            return respond(204);
        }

        return respond(405, { error: 'method or path not supported' });
    } catch (err: any) {
        if (err?.name === 'ConditionalCheckFailedException') {
            return respond(409, { error: 'student already exists' });
        }
        console.error('students_api failed', { error: err?.message ?? err });
        throw err;
    }
}
