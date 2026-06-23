package config

import (
	"errors"
	"os"
)

type Config struct {
	DatabaseURL       string
	Port              string
	FirebaseProjectID string
	CORSOrigin        string
}

func Load() (Config, error) {
	cfg := Config{
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		Port:              os.Getenv("PORT"),
		FirebaseProjectID: os.Getenv("FIREBASE_PROJECT_ID"),
		CORSOrigin:        os.Getenv("CORS_ORIGIN"),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if cfg.FirebaseProjectID == "" {
		return Config{}, errors.New("FIREBASE_PROJECT_ID is required")
	}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if cfg.CORSOrigin == "" {
		cfg.CORSOrigin = "*"
	}
	return cfg, nil
}
