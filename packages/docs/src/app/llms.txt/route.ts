import { llmsIndex } from "~/lib/docs";

export function GET() {
  return new Response(llmsIndex());
}
