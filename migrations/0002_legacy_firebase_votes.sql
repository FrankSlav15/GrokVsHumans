-- One-time import of the anonymous Firebase RTDB vote totals (snapshot 2026-10-19 11:44 CDT).
-- Source: https://grokvshumans-default-rtdb.europe-west1.firebasedatabase.app/battles.json
-- Re-running replaces the snapshot with these values.
INSERT OR REPLACE INTO legacy_votes (item_type, item_id, grok, human, source, imported_at) VALUES
  ('battle','1',1,0,'firebase-rtdb',1792428240),
  ('battle','17',0,2,'firebase-rtdb',1792428240),
  ('battle','19',0,2,'firebase-rtdb',1792428240),
  ('battle','20',0,3,'firebase-rtdb',1792428240),
  ('battle','21',0,3,'firebase-rtdb',1792428240);
