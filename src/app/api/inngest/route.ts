import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { runWorkflow } from "@/lib/inngest/functions";
import { dispatchSchedules } from "@/lib/inngest/schedule";

export const { GET, POST, PUT } = serve({ client: inngest, functions: [runWorkflow, dispatchSchedules] });
