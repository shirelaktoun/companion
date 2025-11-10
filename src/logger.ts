import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

/**
 * Create and configure Winston logger with daily rotation
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

  // Add daily rotating file transport with automatic cleanup
  try {
    transports.push(
      new DailyRotateFile({
        filename: logFile.replace('.log', '-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: '3d',  // Keep logs for 3 days
        maxSize: '20m',  // Rotate when file reaches 20MB
        format
      })
    );
  } catch (err) {
    console.warn(`Could not create rotating file logger at ${logFile}, using console only`);
  }

  return winston.createLogger({
    level: logLevel,
    format,
    transports
  });
}
