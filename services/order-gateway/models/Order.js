const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    productIds: {
      type: [String],
      required: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Completed", "Cancelled"],
      default: "Pending",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Order", orderSchema);
