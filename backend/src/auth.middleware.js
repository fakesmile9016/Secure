import jwt from "jsonwebtoken";

export const protect = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).json({
                message: "Authentication required"
            });
        }

        const token = authHeader.split(" ")[1];

        const decoded = jwt.verify(
            token,
            process.env.JWT_ACCESS_SECRET,
            { algorithms: ["HS256"] }
        );

        req.user = {
            userId: decoded.sub,
            deviceId: decoded.deviceId
        };

        next();
    } catch {
        return res.status(401).json({
            message: "Invalid or expired access token"
        });
    }
};