"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const envCandidates = [
    path_1.default.resolve(process.cwd(), '.env'),
    path_1.default.resolve(__dirname, '../../.env'),
    path_1.default.resolve(__dirname, '../../../.env'),
];
const envPath = envCandidates.find((candidate) => fs_1.default.existsSync(candidate));
dotenv_1.default.config(envPath ? { path: envPath } : undefined);
