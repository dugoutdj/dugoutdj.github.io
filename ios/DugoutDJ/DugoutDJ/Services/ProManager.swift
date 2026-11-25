import Foundation
import StoreKit

@MainActor
final class ProManager: ObservableObject {
    static let yearlyProductID = "com.dugoutdj.pro.yearly"

    @Published private(set) var isPro: Bool = false
    @Published private(set) var yearlyProduct: Product?
    @Published var isLoadingProduct = false
    @Published var isPurchasing = false
    @Published var errorMessage: String?
    @Published var statusMessage: String?

    private var updatesTask: Task<Void, Never>?
    private var didBootstrap = false

    var displayPrice: String {
        yearlyProduct?.displayPrice ?? "$4.99"
    }

    deinit {
        updatesTask?.cancel()
    }

    func bootstrap() async {
        guard !didBootstrap else { return }
        didBootstrap = true

        listenForTransactionUpdates()
        await refreshProduct()
        await refreshEntitlements()
    }

    func refreshProduct() async {
        isLoadingProduct = true
        defer { isLoadingProduct = false }

        do {
            let products = try await Product.products(for: [Self.yearlyProductID])
            yearlyProduct = products.first
        } catch {
            // Fall back to default display price until App Store Connect / StoreKit config loads.
            yearlyProduct = nil
        }
    }

    func refreshEntitlements() async {
        var active = false
        let now = Date()

        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            guard transaction.productID == Self.yearlyProductID else { continue }
            guard transaction.revocationDate == nil else { continue }
            if let expiration = transaction.expirationDate, expiration <= now {
                continue
            }
            active = true
            break
        }

        isPro = active
    }

    @discardableResult
    func purchaseYearly() async -> Bool {
        errorMessage = nil
        statusMessage = nil

        if yearlyProduct == nil {
            await refreshProduct()
        }

        guard let product = yearlyProduct else {
            errorMessage = "Dugout DJ Pro is currently unavailable. Please check your App Store connection and try again."
            return false
        }

        isPurchasing = true
        defer { isPurchasing = false }

        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                switch verification {
                case .verified(let transaction):
                    await transaction.finish()
                    await refreshEntitlements()
                    if isPro {
                        statusMessage = "Welcome to Dugout DJ Pro!"
                        return true
                    }
                    return false
                case .unverified(_, let error):
                    errorMessage = "Purchase could not be verified: \(error.localizedDescription)"
                    return false
                }
            case .userCancelled:
                return false
            case .pending:
                statusMessage = "Purchase is pending approval."
                return false
            @unknown default:
                return false
            }
        } catch {
            errorMessage = "Purchase failed: \(error.localizedDescription)"
            return false
        }
    }

    func restorePurchases() async {
        errorMessage = nil
        statusMessage = nil
        isPurchasing = true
        defer { isPurchasing = false }

        do {
            try await AppStore.sync()
            await refreshEntitlements()
            statusMessage = isPro
                ? "Dugout DJ Pro restored!"
                : "No active Dugout DJ Pro subscription found."
        } catch {
            errorMessage = "Couldn't restore purchases: \(error.localizedDescription)"
        }
    }

    private func listenForTransactionUpdates() {
        updatesTask?.cancel()
        updatesTask = Task { [weak self] in
            for await result in Transaction.updates {
                guard let self else { break }
                if case .verified(let transaction) = result {
                    await transaction.finish()
                    await self.refreshEntitlements()
                }
            }
        }
    }
}
