ALTER TABLE "life_logs" DROP CONSTRAINT "life_logs_type_allowed";

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
    'dream',
    'visualization',
    'manifestation',
    'prayer',
    'journal',
    'other',
    'metadata'
  )
);
