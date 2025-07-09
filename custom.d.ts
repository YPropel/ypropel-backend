import { Request } from "express";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        email?: string;
        isAdmin?: boolean;
      };
    }
  }
}

declare module "cloudinary";
declare module "multer-storage-cloudinary";
