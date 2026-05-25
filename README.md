# NCIT Workshop — Serverless on AWS

Starter project for the *Serverless, not server-less* workshop at NCIT.
You'll build a small serverless stack on AWS — a REST API, an S3 data
analyser, an OCR pipeline, and a scaling-and-retry demo — using AWS
SAM (Serverless Application Model) and TypeScript.

The repo ships with **one tiny "hello" Lambda** wired up so you can
confirm your tooling works end-to-end before you start adding real
resources. Each of the four workshop scenarios is marked `TODO` in
[`template.yaml`](./template.yaml) for you to fill in.

---

## What you'll build

| # | Scenario | AWS services |
|---|---|---|
| 1 | Simple REST API           | API Gateway · Lambda · DynamoDB |
| 2 | Analyze S3 CSV data       | S3 · SQS (+ DLQ) · Lambda |
| 3 | OCR a 1000-page PDF       | S3 · SQS × 2 (+ DLQs) · Lambda × 2 (fan-out) |
| 4 | Scaling & retry demo      | SQS (+ DLQ) · Lambda × 2 (producer + consumer) |

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| **AWS account** | Free tier is enough | Where everything runs |
| **Node.js** | 22.x or newer | Lambda runtime + tooling |
| **AWS CLI** | v2 | Talks to AWS from your terminal |
| **AWS SAM CLI** | latest | Builds & deploys the serverless app |
| **Docker** | optional | Needed only for `sam local invoke` / `start-api` |
| **Git** | any recent | Cloning + committing your work |

---

## Installation

### 1. Node.js 22

- **macOS:**   `brew install node@22`
- **Windows:** download installer from <https://nodejs.org/>
- **Linux:**   `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`

Verify: `node --version` → `v22.x.x`

### 2. AWS CLI v2

- **macOS:**   `brew install awscli`
- **Windows:** download installer from <https://aws.amazon.com/cli/>
- **Linux:**

  ```bash
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
  unzip awscliv2.zip && sudo ./aws/install
  ```

Verify: `aws --version` → `aws-cli/2.x.x`

### 3. AWS SAM CLI

- **macOS:**   `brew install aws-sam-cli`
- **Windows:** download the MSI from <https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html>
- **Linux:**

  ```bash
  wget https://github.com/aws/aws-sam-cli/releases/latest/download/aws-sam-cli-linux-x86_64.zip
  unzip aws-sam-cli-linux-x86_64.zip -d sam-installation
  sudo ./sam-installation/install
  ```

Verify: `sam --version` → `SAM CLI, version 1.x.x`

### 4. Docker (optional — only for local testing)

Install Docker Desktop from <https://www.docker.com/products/docker-desktop/>.
You only need it for `npm run start` (local API) and `npm run invoke:hello`
(local Lambda). Cloud deploys do **not** need Docker.

---

## AWS credentials

1. In the AWS Console, open **IAM → Users → your-user → Security credentials → Create access key**.
2. Save the **Access key ID** and **Secret access key**.
3. Configure a named profile locally:

   ```bash
   aws configure --profile workshop
   #   AWS Access Key ID:     <paste>
   #   AWS Secret Access Key: <paste>
   #   Default region:        ap-south-1     (Mumbai is closest to Nepal)
   #   Default output:        json
   ```

4. Tell SAM which profile to use — either:

   - **Per-command:** `npm run deploy -- --profile workshop`
   - **Pinned in [`samconfig.toml`](./samconfig.toml):** uncomment the `profile` line
     and set it to `workshop` (or whatever name you chose).

Verify: `aws sts get-caller-identity --profile workshop` should print your
account ID and IAM user ARN.

---

## How SAM CLI manages your resources

SAM is a thin convention on top of CloudFormation:

- You describe your **infrastructure** (Lambda, S3, SQS, DynamoDB, IAM…)
  declaratively in `template.yaml`.
- `sam build` runs `esbuild` on each TypeScript Lambda and writes the
  bundles to `.aws-sam/build/`.
- `sam deploy` translates your template to a CloudFormation **stack**
  (named `ncit-demo`) and applies any changes — creating new resources,
  updating changed ones, deleting removed ones.
- Every deploy is an **atomic update**: if any resource fails to create
  or update, CloudFormation rolls the entire change back.
- `sam delete` tears down the whole stack in one command — useful at the
  end of the workshop so nothing keeps billing.

In short: **your `template.yaml` is the single source of truth**.
Never click around the AWS console to change resources — change the
template, redeploy, and let SAM/CloudFormation reconcile.

---

## Project structure

```
ncit-demo/
├── template.yaml         ← SAM template. Add scenarios 1–4 here.
├── samconfig.toml        ← deploy defaults (region, stack name, profile)
├── package.json          ← npm scripts (build, deploy, logs, etc.)
├── tsconfig.json         ← TypeScript compiler config
├── functions/
│   └── hello.ts          ← the "hello" Lambda you start from
└── events/
    └── api-hello.json    ← sample event for `sam local invoke`
```

When you add a scenario, you'll typically:

1. Add the AWS resources (Lambda, queue, bucket…) under `Resources:` in `template.yaml`.
2. Add the handler in `functions/<name>.ts`.
3. Wire the handler to the Lambda with `CodeUri: .` and `Handler: functions/<name>.handler`,
   plus a `Metadata.BuildMethod: esbuild` block (copy from `HelloFunction`).

---

## Workflow

```bash
# one-time
npm install

# every change
npm run validate         # lint the template
npm run build            # esbuild → .aws-sam/build/
npm run deploy           # ship it (first time: npm run deploy:guided)

# verify
curl https://<HelloUrl>/hello   # URL comes from the deploy output
npm run logs:hello              # tail Lambda logs in real time

# at the end of the workshop
npm run destroy          # delete the whole stack
```

---

## Common commands

| Command | What it does |
|---|---|
| `npm run validate`      | Lint the SAM template before building |
| `npm run build`         | Compile TypeScript → CommonJS bundles via esbuild |
| `npm run deploy:guided` | First-time deploy (asks where to put the build artifacts) |
| `npm run deploy`        | Subsequent deploys |
| `npm run start`         | Run the API locally (`localhost:3000`) — needs Docker |
| `npm run invoke:hello`  | Invoke the hello Lambda locally with a sample event |
| `npm run logs:hello`    | Tail CloudWatch logs for the hello Lambda |
| `npm run destroy`       | Tear down the CloudFormation stack |

---

## Smoke test (do this first)

```bash
npm install
npm run deploy:guided           # accept the defaults
# copy the HelloUrl from the output, then:
curl https://<HelloUrl>/hello
# expected: {"message":"hello, ncit"}
```

If you see the `hello, ncit` JSON back, your AWS account, CLI, SAM, and
the template all work together. You're ready to start building.

---

## Workshop scenarios (your TODO list)

Each section in `template.yaml` has a `# TODO` block for the resources
you need to add. The handler files live under `functions/`.

### Scenario 1 — Simple REST API
- DynamoDB table for students (`PartitionKey: id`, on-demand)
- HTTP API with 4 routes: `POST/GET/DELETE /students`, `GET /students/{id}`
- Lambda that handles them; `DynamoDBCrudPolicy` on the table

### Scenario 2 — Analyze S3 CSV data
- S3 bucket with an ObjectCreated notification → SQS
- SQS queue + DLQ + queue policy that lets S3 publish
- Lambda triggered by SQS (`BatchSize: 1`) that reads the CSV
  and writes a JSON summary to a `reports/` prefix

### Scenario 3 — OCR a 1000-page PDF (fan-out)
- Front queue + DLQ (S3 events land here)
- **Splitter Lambda**: opens the PDF with `pdfjs-dist`, counts pages,
  fans out one SQS message per page to a second queue
- Page queue + DLQ
- **Page-worker Lambda**: extracts text for one page (or OCRs an image
  with `tesseract.js`); writes to `extracted/<name>/page-NNNN.txt`
- AWS scales the page worker concurrently up to your account limit —
  that's the **delegation pattern** from slide 10

### Scenario 4 — Scaling & retry demo
- One SQS queue + DLQ
- **Producer Lambda** (CLI-invoked): `SendMessageBatch` fires N messages
  in parallel
- **Consumer Lambda** with `FunctionResponseTypes: [ReportBatchItemFailures]`:
  fails every 10th message on purpose so you can watch SQS retry
  individual messages, see the DLQ fill, and watch concurrency in CloudWatch

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `ExpiredToken` / `Unable to locate credentials` | AWS credentials missing or expired. Run `aws configure --profile workshop`. |
| `BucketAlreadyExists` | S3 bucket names are globally unique. Use `${AWS::AccountId}` in the name. |
| Lambda function `InvalidRequest` for concurrency | New AWS accounts cap Lambda concurrency at 10. Don't set `ReservedConcurrentExecutions`. |
| `Error: Cannot find module 'X'` at runtime | Module not in `package.json`, or marked `External` without shipping a layer. |
| Deploy hangs at `CREATE_IN_PROGRESS` for an S3 bucket | A QueuePolicy is missing — S3 can't publish to your SQS queue. Add it. |
| Stack stuck in `ROLLBACK_COMPLETE` | Stack is unusable — delete it and redeploy: `npm run destroy` then `npm run deploy:guided`. |

---

## Cleanup

When you're done, **destroy the stack** so nothing keeps billing
(the buckets and DDB table do cost a tiny amount if left around):

```bash
# empty the S3 buckets first (CloudFormation refuses to delete non-empty buckets)
aws --profile workshop s3 rm s3://ncit-demo-csv-<account-id>  --recursive
aws --profile workshop s3 rm s3://ncit-demo-pdf-<account-id>  --recursive
npm run destroy
```

---

## Reference docs

- [AWS SAM developer guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/what-is-sam.html)
- [SAM template reference](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-specification.html)
- [Lambda Node.js runtime](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html)
- [SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [ReportBatchItemFailures](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#services-sqs-batchfailurereporting)

Happy shipping 👋
