-- CreateTable
CREATE TABLE "GenerationHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "textResult" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GenerationHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImageGeneration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "resultUrl" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "historyId" INTEGER,
    CONSTRAINT "ImageGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageGeneration_historyId_fkey" FOREIGN KEY ("historyId") REFERENCES "GenerationHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "GenerationHistory" ("id", "userId", "modelId", "modelName", "taskType", "prompt", "sourceUrl", "textResult", "createdAt", "updatedAt")
SELECT
    "id",
    "userId",
    '',
    '历史图片',
    CASE WHEN "sourceUrl" = '' THEN 'text_to_image' ELSE 'image_edit' END,
    "prompt",
    "sourceUrl",
    '',
    "createdAt",
    "createdAt"
FROM "ImageGeneration";
INSERT INTO "new_ImageGeneration" ("createdAt", "historyId", "id", "prompt", "resultUrl", "sourceUrl", "userId") SELECT "createdAt", "id", "id", "prompt", "resultUrl", "sourceUrl", "userId" FROM "ImageGeneration";
DROP TABLE "ImageGeneration";
ALTER TABLE "new_ImageGeneration" RENAME TO "ImageGeneration";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "GenerationHistory_userId_createdAt_idx" ON "GenerationHistory"("userId", "createdAt");
