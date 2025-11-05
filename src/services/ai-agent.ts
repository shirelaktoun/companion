import Anthropic from '@anthropic-ai/sdk';
import { Logger } from 'winston';
import { ConversationMessage, AgentConfig } from '../types';

/**
 * AI Agent service using Claude API
 */
export class AIAgent {
  private client: Anthropic;
  private logger: Logger;
  private config: AgentConfig;
  private model: string;
  private maxTokens: number;

  constructor(
    apiKey: string,
    config: AgentConfig,
    model: string,
    maxTokens: number,
    logger: Logger
  ) {
    this.client = new Anthropic({ apiKey });
    this.config = config;
    this.model = model;
    this.maxTokens = maxTokens;
    this.logger = logger;
    this.logger.info('AI Agent initialized with Claude API');
  }

  /**
   * Get system prompt for the AI companion
   */
  private getSystemPrompt(): string {
    return `You are ${this.config.name}, a ${this.config.personality} AI companion agent who speaks with people over the telephone.

Your role is to:
1. Hold warm, natural, casual conversations with callers
2. Check on the wellbeing of the people you speak with
3. Listen actively and show genuine care and interest
4. Offer help and support where appropriate
5. Be a friendly, compassionate presence in their day

Important guidelines for phone conversations:
- Keep your responses concise and conversational (1-3 sentences typically)
- Speak naturally, as you would in a real phone call
- Use verbal acknowledgments like "I see", "mm-hmm", "that makes sense"
- Ask open-ended questions to encourage the caller to share
- Show empathy and understanding
- If someone seems distressed, offer support and ask how you can help
- Be patient and let people take their time speaking
- Don't be overly formal or robotic - be warm and human-like
- Remember that pauses are normal in phone conversations
- If appropriate, you can share brief relevant thoughts or gentle encouragement

You are having a real-time voice conversation, so:
- Avoid using lists, bullet points, or formatted text
- Don't say things like "here's what I think" followed by numbered points
- Instead, speak naturally as if chatting with a friend
- Keep technical jargon to a minimum
- Be conversational, not presentational

Your primary goal is to be a caring companion who makes people feel heard, valued, and supported.`;
  }

  /**
   * Generate a response based on conversation history
   */
  async generateResponse(
    conversationHistory: ConversationMessage[],
    currentInput?: string
  ): Promise<string> {
    try {
      // Build messages array
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

      // Add conversation history
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }

      // Add current input if provided
      if (currentInput && currentInput.trim().length > 0) {
        messages.push({
          role: 'user',
          content: currentInput
        });
      }

      // If no messages, start with a greeting
      if (messages.length === 0) {
        return this.getGreeting();
      }

      this.logger.debug(`Generating AI response for conversation with ${messages.length} messages`);

      // Call Claude API
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.getSystemPrompt(),
        messages
      });

      // Extract text from response
      const textContent = response.content.find(block => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text content in Claude response');
      }

      const aiResponse = textContent.text.trim();
      this.logger.debug(`AI response: ${aiResponse.substring(0, 100)}...`);

      return aiResponse;

    } catch (error) {
      this.logger.error('Error generating AI response:', error);
      throw error;
    }
  }

  /**
   * Get a greeting message for starting a call
   */
  private getGreeting(): string {
    const greetings = [
      `Hello! This is ${this.config.name}. How are you doing today?`,
      `Hi there! ${this.config.name} here. How's your day going?`,
      `Hello! This is ${this.config.name}. It's nice to hear from you. How are you?`,
      `Hi! ${this.config.name} speaking. How are things with you today?`
    ];

    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  /**
   * Generate a response for when the user hasn't spoken
   */
  async generateSilencePrompt(conversationHistory: ConversationMessage[]): Promise<string> {
    // If there's no conversation yet, use a gentle greeting
    if (conversationHistory.length === 0) {
      return `Hello? This is ${this.config.name}. Are you there?`;
    }

    // Otherwise, acknowledge the silence
    const prompts = [
      "Are you still there?",
      "Hello? Can you hear me?",
      "Is everything okay?",
      "I'm here if you'd like to talk."
    ];

    return prompts[Math.floor(Math.random() * prompts.length)];
  }

  /**
   * Generate a farewell message
   */
  getFarewell(): string {
    const farewells = [
      "Take care! It was nice talking with you.",
      "Goodbye! Feel free to call again anytime.",
      "Have a wonderful day! Talk to you soon.",
      "Take care of yourself! Goodbye!"
    ];

    return farewells[Math.floor(Math.random() * farewells.length)];
  }

  /**
   * Analyze conversation for wellbeing concerns
   */
  async analyzeWellbeing(conversationHistory: ConversationMessage[]): Promise<{
    concernLevel: 'none' | 'low' | 'medium' | 'high';
    suggestions: string[];
  }> {
    if (conversationHistory.length === 0) {
      return { concernLevel: 'none', suggestions: [] };
    }

    try {
      // Create a meta-analysis prompt
      const analysisPrompt = `Based on this conversation, assess the person's wellbeing and identify any concerns.
Conversation:
${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}

Respond with a JSON object containing:
- concernLevel: "none", "low", "medium", or "high"
- suggestions: array of helpful suggestions or next steps (if any)`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 500,
        messages: [{ role: 'user', content: analysisPrompt }]
      });

      const textContent = response.content.find(block => block.type === 'text');
      if (textContent && textContent.type === 'text') {
        // Try to parse JSON from response
        const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      }

      return { concernLevel: 'none', suggestions: [] };

    } catch (error) {
      this.logger.error('Error analyzing wellbeing:', error);
      return { concernLevel: 'none', suggestions: [] };
    }
  }
}
