import winston from 'winston';
import path from 'path';
import fs from 'fs';

/**
 * Create and configure Winston logger
 */
export function createLogger(logLevel: string, logFile: string): winston.Logger {
  // Ensure log directory exists
  const logDir = path.dirname(logFile);
  if (!fs.existsSync(logDir)) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch (err) {
      // If we can't create the log directory, fall back to current directory
      logFile = path.join(process.cwd(), 'companion.log');
    }
  }

  const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      if (stack) {
        return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
      }
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  );

  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        format
      )
    })
  ];

  // Add file transport if we can write to the log file
  try {
    transports.push(
      new winston.transports.File({
        filename: logFile,
        format
      })
    );
  } catch (err) {
    console.warn(`Could not create file logger at ${logFile}, using console only`);
  }

  return winston.createLogger({
    level: logLevel,
    format,
    transports
  });
}
