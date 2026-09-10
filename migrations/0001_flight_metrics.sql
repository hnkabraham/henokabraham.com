CREATE TABLE IF NOT EXISTS flight_metrics (
  hour TEXT NOT NULL,
  event TEXT NOT NULL,
  device TEXT NOT NULL,
  motion TEXT NOT NULL,
  samples INTEGER NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  minimum REAL NOT NULL,
  maximum REAL NOT NULL,
  PRIMARY KEY (hour, event, device, motion)
);
