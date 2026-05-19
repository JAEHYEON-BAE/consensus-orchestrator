export interface AgentAdapter {
  readonly name: string;
  call(prompt: string): Promise<string>;
}
