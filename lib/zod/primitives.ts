import { z } from "zod";

// ISO string from the API → real Date, failing validation on unparseable input.
export const ApiDateTime = z.string().transform((value, context) => {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    context.addIssue({ code: "custom", message: `Invalid datetime: ${value}` });
    return z.NEVER;
  }

  return parsed;
});
