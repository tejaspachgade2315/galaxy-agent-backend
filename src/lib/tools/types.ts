import { z } from "zod";

export interface ToolExecutionContext {
  chatId: string;
  runId: string;
  userId: string;
  signal?: AbortSignal;
}

export interface AgentTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<any, any, any>;
  outputSchema: z.ZodType<any, any, any>;
  creditsCost: number;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

/**
 * Converts a Zod Schema into standard JSON Schema parameters for OpenAI/OpenRouter tool calling.
 */
export function zodToJsonSchema(schema: z.ZodType<any, any, any>): Record<string, any> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const key of Object.keys(shape)) {
      const fieldSchema = shape[key];
      properties[key] = fieldToJsonSchema(fieldSchema);
      if (!fieldSchema.isOptional()) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return { type: "object", properties: {} };
}

function fieldToJsonSchema(field: z.ZodType<any, any, any>): Record<string, any> {
  if (field instanceof z.ZodOptional || field instanceof z.ZodNullable) {
    return fieldToJsonSchema(field.unwrap());
  }
  if (field instanceof z.ZodDefault) {
    return fieldToJsonSchema(field._def.innerType);
  }
  if (field instanceof z.ZodString) {
    return { type: "string", description: field.description };
  }
  if (field instanceof z.ZodNumber) {
    return { type: "number", description: field.description };
  }
  if (field instanceof z.ZodBoolean) {
    return { type: "boolean", description: field.description };
  }
  if (field instanceof z.ZodArray) {
    return {
      type: "array",
      items: fieldToJsonSchema(field.element),
      description: field.description,
    };
  }
  if (field instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: field._def.values,
      description: field.description,
    };
  }
  if (field instanceof z.ZodObject) {
    return zodToJsonSchema(field);
  }
  return { type: "string" };
}
