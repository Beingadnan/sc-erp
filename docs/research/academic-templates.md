# Starter academic templates — sources and caveats

Status: Phase 3a. **To be confirmed with pilot schools** (CBSE and RBSE) before general release.

The starter template (`POST /academic/setup-template`) only seeds editable records. Nothing is
enforced from it.

| Item | What we seed | Basis | Confidence |
| --- | --- | --- | --- |
| Classes | Nursery, LKG, UKG, Class 1–12 | Common structure of Indian private schools | High |
| Stages | Pre-primary, primary (1–5), middle (6–8), secondary (9–10), senior secondary (11–12) | NEP / board stage naming | High |
| Subjects | English, Hindi, Mathematics, EVS, Science, Social Science, Sanskrit, Computer Science; co-scholastic Art, Health & PE, Work Education | Common core for CBSE and RBSE schools | Medium — third language and EVS years vary |
| Class 11–12 | Only English + co-scholastic | Streams differ per school | — schools add stream subjects |
| CBSE scale | A1 91–100 (10) … D 33–40 (4), E ≤ 32 | CBSE eight-band grading used for classes 9–10 under CCE, still common on internal report cards | Medium — confirm current internal practice |
| RBSE scale | Divisions: I ≥ 60 %, II ≥ 45 %, III ≥ 33 %, below 33 % fail | Rajasthan Board result divisions | Medium — internal exams may use grades |
| Primary scale | A+ ≥ 90, A ≥ 75, B ≥ 56, C ≥ 35, D below | Typical descriptive scale | Low — placeholder for school's own |

Bands use two decimals (e.g. 81–90.99) so no percentage falls between two grades.

Questions for pilot schools (add to the interview script):
1. Which grading scheme is printed on internal report cards for each class range?
2. Third language: Sanskrit, Urdu, Punjabi or other? From which class?
3. Weekly offs: Sunday only, or 2nd/4th Saturday too? Same for all campuses?
4. How many terms, and do terms align with exam cycles (half-yearly / annual)?
