#!/bin/sh
set -eu

# Local topology mirrors the documented example: one SNS topic, two independent
# consumer groups, and one processing DLQ per group. This never uses real AWS.
TOPIC_ARN=$(awslocal sns create-topic --name identity --query TopicArn --output text)
for QUEUE in email-service analytics-service; do
  DLQ_ARN=$(awslocal sqs create-queue --queue-name "${QUEUE}-dlq" --attributes MessageRetentionPeriod=1209600 --query QueueUrl --output text | xargs -I{} awslocal sqs get-queue-attributes --queue-url {} --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
  QUEUE_URL=$(awslocal sqs create-queue --queue-name "$QUEUE" --attributes ReceiveMessageWaitTimeSeconds=20,VisibilityTimeout=60 --query QueueUrl --output text)
  QUEUE_ARN=$(awslocal sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
  awslocal sqs set-queue-attributes --queue-url "$QUEUE_URL" --attributes RedrivePolicy="{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"5\"}",Policy="{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"sns.amazonaws.com\"},\"Action\":\"sqs:SendMessage\",\"Resource\":\"$QUEUE_ARN\",\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":\"$TOPIC_ARN\"}}}]}"
  awslocal sns subscribe --topic-arn "$TOPIC_ARN" --protocol sqs --notification-endpoint "$QUEUE_ARN" --attributes RawMessageDelivery=true >/dev/null
done
