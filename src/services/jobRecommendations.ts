// src/services/jobRecommendations.ts

import { query } from "../../db";

/**
 * Returns jobs matching the user's past interests.
 * - Matches category + job_type
 * - Excludes jobs the user already interacted with
 */
export async function getJobRecommendationsForUser(
  userId: number,
  limit: number = 10
) {
  // 1) What categories + job types did the user show interest in?
  const interestsRes = await query(
    `
    SELECT DISTINCT category, job_type
    FROM job_interest_events
    WHERE user_id = $1
      AND category IS NOT NULL
      AND job_type IS NOT NULL
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

  if (categories.length === 0 || jobTypes.length === 0) {
    return [];
  }

  // 2) Recommend jobs in those same categories & job types,
  //    excluding jobs they already interacted with
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
