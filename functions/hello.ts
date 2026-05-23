// Starter Lambda — proves the toolchain works end-to-end.
//
// Hit  GET <HelloUrl>/hello  after deploy.  You should see:
//   { "message": "hello, ncit" }

import {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';

export async function handler(
    _event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello, ncit' }),
    };
}
