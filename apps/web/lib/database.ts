import { connect } from "@datadeal/database";

export const database = process.env.DATABASE_URL
  ? connect(process.env.DATABASE_URL, {
      reusePool: process.env.NODE_ENV === "development",
    })
  : null;
