// Types for the parts of export-openapi.mjs that the tests import.
export function pythonFailure(stderr: unknown, platform?: string): string;
export function generateSchema(): string;
export function backendPython(): string;
