/*
  Warnings:

  - A unique constraint covering the columns `[conversation_id]` on the table `leads` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `conversation_id` to the `leads` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "ConversationStatus" ADD VALUE 'HUMAN_REQUESTED';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "conversation_id" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "leads_conversation_id_key" ON "leads"("conversation_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
