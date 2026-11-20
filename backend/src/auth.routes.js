
import express from "express";

const router = express.Router();

router.get("/test", (req, res) => {
    res.status(200).json({
        success: true,
        message: "SecureChat Auth Routes Working"
    });
});

export default router;
