class ProductSearchApp {
    constructor() {
        this.currentPage = 1;
        this.perPage = 20;
        this.currentFilters = {};
        this.init();
    }

    init() {
        // Set up event listeners
        document.getElementById('searchForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.search();
        });

        // Auto-search on input change with debounce
        const titleInput = document.getElementById('title');
        let searchTimeout;
        titleInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                if (titleInput.value.length >= 2 || titleInput.value.length === 0) {
                    this.search();
                }
            }, 500);
        });

        // Load initial data
        this.loadFacets();
        this.performInitialSearch();
    }

    async performInitialSearch() {
        // Perform a search with no filters to show some products
        await this.search();
    }

    async search(page = 1) {
        this.currentPage = page;
        this.showLoading(true);

        try {
            // Collect filters
            const filters = {
                title: document.getElementById('title').value.trim() || undefined,
                brand: document.getElementById('brand').value.trim() || undefined,
                category: document.getElementById('category').value.trim() || undefined,
                min_price: parseFloat(document.getElementById('minPrice').value) || undefined,
                max_price: parseFloat(document.getElementById('maxPrice').value) || undefined,
                shop: document.getElementById('shop').value || undefined,
                availability: document.getElementById('availability').value ? 
                    document.getElementById('availability').value === 'true' : undefined,
                page: page,
                per_page: this.perPage
            };

            // Remove undefined values
            Object.keys(filters).forEach(key => {
                if (filters[key] === undefined) {
                    delete filters[key];
                }
            });

            this.currentFilters = filters;

            // Make API call
            const response = await axios.get('/search', { params: filters });
            this.displayResults(response.data);

        } catch (error) {
            console.error('Search error:', error);
            this.showError('Search failed. Please try again.');
        } finally {
            this.showLoading(false);
        }
    }

    displayResults(data) {
        const resultsContainer = document.getElementById('searchResults');
        
        if (data.products.length === 0) {
            resultsContainer.innerHTML = `
                <div class="alert alert-info">
                    <i class="fas fa-info-circle me-2"></i>
                    No products found matching your criteria.
                </div>
            `;
            return;
        }

        let html = `
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">
                        <i class="fas fa-box me-2"></i>
                        Search Results (${data.total} products)
                    </h5>
                    <small class="text-muted">
                        Search took ${data.execution_time_ms}ms
                    </small>
                </div>
                <div class="card-body">
                    <div class="row">
        `;

        data.products.forEach(product => {
            html += this.createProductCard(product);
        });

        html += `
                    </div>
                </div>
            </div>
        `;

        // Add pagination
        if (data.total_pages > 1) {
            html += this.createPagination(data);
        }

        resultsContainer.innerHTML = html;
    }

    createProductCard(product) {
        const imageUrl = product.image_url || 'https://via.placeholder.com/200x150?text=No+Image';
        const availability = product.availability ? 
            '<span class="badge bg-success">Available</span>' : 
            '<span class="badge bg-danger">Out of Stock</span>';
        
        const price = product.price ? `€${product.price.toFixed(2)}` : 'Price not available';
        const originalPrice = product.original_price && product.original_price > product.price ? 
            `<del class="text-muted">€${product.original_price.toFixed(2)}</del>` : '';
        
        return `
            <div class="col-md-6 col-lg-4 mb-4">
                <div class="card h-100 product-card">
                    <img src="${imageUrl}" class="card-img-top" alt="${product.title}" style="height: 200px; object-fit: cover;">
                    <div class="card-body d-flex flex-column">
                        <h6 class="card-title">${product.title}</h6>
                        <p class="card-text text-muted small">${product.description ? product.description.substring(0, 100) + '...' : ''}</p>
                        <div class="mt-auto">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <div class="price">
                                    <strong class="text-primary">${price}</strong>
                                    ${originalPrice}
                                </div>
                                ${availability}
                            </div>
                            <div class="d-flex justify-content-between align-items-center">
                                <small class="text-muted">
                                    ${product.brand ? product.brand.name : 'No Brand'} | 
                                    ${product.shop ? product.shop.name : 'Unknown Shop'}
                                </small>
                                <button class="btn btn-sm btn-outline-primary" onclick="app.showProductDetails('${product.ean || product.id}')">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    createPagination(data) {
        let html = `
            <nav aria-label="Search results pagination">
                <ul class="pagination justify-content-center">
        `;

        // Previous button
        if (data.page > 1) {
            html += `
                <li class="page-item">
                    <a class="page-link" href="#" onclick="app.search(${data.page - 1})">Previous</a>
                </li>
            `;
        }

        // Page numbers
        const startPage = Math.max(1, data.page - 2);
        const endPage = Math.min(data.total_pages, data.page + 2);

        for (let i = startPage; i <= endPage; i++) {
            html += `
                <li class="page-item ${i === data.page ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="app.search(${i})">${i}</a>
                </li>
            `;
        }

        // Next button
        if (data.page < data.total_pages) {
            html += `
                <li class="page-item">
                    <a class="page-link" href="#" onclick="app.search(${data.page + 1})">Next</a>
                </li>
            `;
        }

        html += `
                </ul>
            </nav>
        `;

        return html;
    }

    async showProductDetails(productId) {
        try {
            const response = await axios.get(`/product/${productId}`);
            const product = response.data;

            const modalBody = document.getElementById('productModalBody');
            modalBody.innerHTML = `
                <div class="row">
                    <div class="col-md-6">
                        <img src="${product.image_url || 'https://via.placeholder.com/400x300?text=No+Image'}" 
                             class="img-fluid" alt="${product.title}">
                    </div>
                    <div class="col-md-6">
                        <h5>${product.title}</h5>
                        <p class="text-muted">${product.description || 'No description available'}</p>
                        
                        <div class="mb-3">
                            <strong>Price:</strong> €${product.price ? product.price.toFixed(2) : 'N/A'}
                            ${product.original_price && product.original_price > product.price ? 
                                `<del class="text-muted ms-2">€${product.original_price.toFixed(2)}</del>` : ''}
                        </div>
                        
                        <div class="mb-3">
                            <strong>Availability:</strong> 
                            ${product.availability ? 
                                '<span class="badge bg-success">Available</span>' : 
                                '<span class="badge bg-danger">Out of Stock</span>'}
                        </div>
                        
                        <div class="mb-3">
                            <strong>Brand:</strong> ${product.brand ? product.brand.name : 'N/A'}
                        </div>
                        
                        <div class="mb-3">
                            <strong>Shop:</strong> ${product.shop ? product.shop.name : 'N/A'}
                        </div>
                        
                        ${product.ean ? `<div class="mb-3"><strong>EAN:</strong> ${product.ean}</div>` : ''}
                        ${product.mpn ? `<div class="mb-3"><strong>MPN:</strong> ${product.mpn}</div>` : ''}
                        
                        ${product.variants && product.variants.length > 0 ? `
                            <div class="mb-3">
                                <strong>Variants:</strong>
                                <ul class="list-unstyled">
                                    ${product.variants.map(variant => `
                                        <li>
                                            ${variant.color ? `Color: ${variant.color}` : ''}
                                            ${variant.size ? `Size: ${variant.size}` : ''}
                                            ${variant.price ? `Price: €${variant.price.toFixed(2)}` : ''}
                                        </li>
                                    `).join('')}
                                </ul>
                            </div>
                        ` : ''}
                        
                        ${product.product_url ? `
                            <a href="${product.product_url}" target="_blank" class="btn btn-primary">
                                <i class="fas fa-external-link-alt me-2"></i>
                                View on Store
                            </a>
                        ` : ''}
                    </div>
                </div>
            `;

            const modal = new bootstrap.Modal(document.getElementById('productModal'));
            modal.show();

        } catch (error) {
            console.error('Error loading product details:', error);
            this.showError('Failed to load product details.');
        }
    }

    async loadFacets() {
        try {
            const response = await axios.get('/facets');
            // You can use this data to populate filter dropdowns
            console.log('Facets loaded:', response.data);
        } catch (error) {
            console.error('Error loading facets:', error);
        }
    }

    async showStats() {
        try {
            const response = await axios.get('/admin/stats');
            const stats = response.data;

            const modalBody = document.getElementById('statsModalBody');
            modalBody.innerHTML = `
                <div class="row">
                    <div class="col-6">
                        <div class="card bg-primary text-white">
                            <div class="card-body text-center">
                                <h2>${stats.shops}</h2>
                                <p>Shops</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="card bg-success text-white">
                            <div class="card-body text-center">
                                <h2>${stats.products}</h2>
                                <p>Products</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="card bg-info text-white">
                            <div class="card-body text-center">
                                <h2>${stats.brands}</h2>
                                <p>Brands</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="card bg-warning text-white">
                            <div class="card-body text-center">
                                <h2>${stats.categories}</h2>
                                <p>Categories</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="mt-3">
                    <p><strong>Last Sync:</strong> ${stats.last_sync ? new Date(stats.last_sync).toLocaleString() : 'Never'}</p>
                    <p><strong>Sync Status:</strong> <span class="badge ${stats.sync_status === 'completed' ? 'bg-success' : 'bg-warning'}">${stats.sync_status || 'Unknown'}</span></p>
                </div>
            `;

            const modal = new bootstrap.Modal(document.getElementById('statsModal'));
            modal.show();

        } catch (error) {
            console.error('Error loading stats:', error);
            this.showError('Failed to load statistics.');
        }
    }

    async processFeeds() {
        if (!confirm('This will process all XML feeds. This may take several minutes. Continue?')) {
            return;
        }

        try {
            this.showLoading(true, 'Processing feeds...');
            const response = await axios.post('/admin/process-feeds');
            
            let message = 'Feed processing completed:\n\n';
            response.data.forEach(result => {
                message += `${result.shop_name}: ${result.status}\n`;
                message += `  Products: ${result.products_processed} (${result.products_created} new, ${result.products_updated} updated)\n`;
                if (result.errors.length > 0) {
                    message += `  Errors: ${result.errors.length}\n`;
                }
                message += '\n';
            });

            alert(message);
            
            // Refresh the search results
            await this.search();

        } catch (error) {
            console.error('Error processing feeds:', error);
            this.showError('Failed to process feeds.');
        } finally {
            this.showLoading(false);
        }
    }

    clearSearch() {
        document.getElementById('searchForm').reset();
        this.search();
    }

    showLoading(show, message = 'Loading...') {
        const spinner = document.getElementById('loadingSpinner');
        if (show) {
            spinner.style.display = 'block';
            spinner.querySelector('p').textContent = message;
        } else {
            spinner.style.display = 'none';
        }
    }

    showError(message) {
        const resultsContainer = document.getElementById('searchResults');
        resultsContainer.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>
                ${message}
            </div>
        `;
    }
}

// Global functions for onclick handlers
function showStats() {
    app.showStats();
}

function processFeeds() {
    app.processFeeds();
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ProductSearchApp();
});
