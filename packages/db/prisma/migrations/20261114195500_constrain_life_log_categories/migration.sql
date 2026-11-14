ALTER TABLE "life_logs"
ADD CONSTRAINT "life_logs_type_allowed" CHECK (
  "type" IN (
    'health',
    'medication',
    'food',
    'exercise',
    'sleep',
    'mood',
    'social',
    'work',
    'travel',
    'finance',
    'household',
    'personal-care',
    'entertainment',
    'journal',
    'other',
    'metadata'
  )
);

ALTER TABLE "life_logs"
ADD CONSTRAINT "life_logs_metadata_type" CHECK (
  ("type" = 'metadata') = ("metadata_key" IS NOT NULL AND "metadata_value" IS NOT NULL)
);
