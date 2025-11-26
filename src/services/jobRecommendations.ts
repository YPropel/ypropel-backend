// src/services/jobRecommendations.ts
import { query } from "../../db";

export async function getJobRecommendationsForUser(
  userId: number,
  limit: number = 10
) {
  // 1) Get the categories & job_types this user has shown interest in
  const interestsRes = await query(
    `
    SELECT DISTINCT category, job_type
    FROM job_interest_events
    WHERE user_id = $1
      AND category IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 50;
  `,
    [userId]
  );

  if (interestsRes.rows.length === 0) {
    return [];
  }

  const categories = interestsRes.rows
    .map((r) => r.category)
    .filter(Boolean) as string[];
  const jobTypes = interestsRes.rows
    .map((r) => r.job_type)
    .filter(Boolean) as string[];

  // 2) Recommend recent jobs matching those categories / job types
  // and that the user hasn't already viewed/applied (no interest event yet)
  const recRes = await query(
    `
    SELECT j.*
    FROM jobs j
    WHERE j.is_active = TRUE
      AND j.category = ANY($2::text[])
      AND j.job_type = ANY($3::text[])
      AND j.id NOT IN (
        SELECT job_id FROM job_interest_events WHERE user_id = $1
      )
    ORDER BY j.posted_at DESC
    LIMIT $4;
  `,
    [userId, categories, jobTypes, limit]
  );

  return recRes.rows;
}
