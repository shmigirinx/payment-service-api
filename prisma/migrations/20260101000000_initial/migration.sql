CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Account" (
  "id" UUID NOT NULL,
  "ownerId" UUID NOT NULL,
  "balance" BIGINT NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Account_balance_nonnegative" CHECK ("balance" >= 0),
  CONSTRAINT "Account_currency_rub" CHECK ("currency" = 'RUB')
);

CREATE TABLE "Transfer" (
  "id" UUID NOT NULL,
  "senderId" UUID NOT NULL,
  "recipientId" UUID NOT NULL,
  "amount" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Transfer_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "Transfer_different_accounts" CHECK ("senderId" <> "recipientId"),
  CONSTRAINT "Transfer_currency_rub" CHECK ("currency" = 'RUB')
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Account_ownerId_key" ON "Account"("ownerId");
CREATE UNIQUE INDEX "Transfer_senderId_idempotencyKey_key"
  ON "Transfer"("senderId", "idempotencyKey");
CREATE INDEX "Transfer_senderId_createdAt_id_idx"
  ON "Transfer"("senderId", "createdAt", "id");
CREATE INDEX "Transfer_recipientId_createdAt_id_idx"
  ON "Transfer"("recipientId", "createdAt", "id");

ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
