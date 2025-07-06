class ModernSearchApp {
    constructor() {
        this.searchInput = document.getElementById('mainSearch');
        this.searchBtn = document.getElementById('searchBtn');
        this.suggestionsDropdown = document.getElementById('suggestionsDropdown');
        this.productGrid = document.getElementById('productGrid');
        this.resultsContainer = document.getElementById('resultsContainer');
        this.loadingSpinner = document.getElementById('loadingSpinner');
        this.noResults = document.getElementById('noResults');
        this.resultsCount = document.getElementById('resultsCount');
        this.resultsMeta = document.getElementById('resultsMeta');
        this.searchStats = document.getElementById('searchStats');
        this.categoryResults = document.getElementById('categoryResults');
        this.categoryList = document.getElementById('categoryList');
        this.paginationContainer = document.getElementById('paginationContainer');

        // Filter elements
        this.filterSidebar = document.getElementById('filterSidebar');
        this.brandFilters = document.getElementById('brandFilters');
        this.categoryFilters = document.getElementById('categoryFilters');
        this.shopFilters = document.getElementById('shopFilters');
        this.activeFilters = document.getElementById('activeFilters');
        this.clearFiltersBtn = document.getElementById('clearFilters');

        // Mobile elements
        this.mobileFilterBtn = document.getElementById('mobileFilterBtn');
        this.filterBackdrop = document.getElementById('filterBackdrop');
        this.closeMobileFilters = document.getElementById('closeMobileFilters');

        // Price range
        this.priceRangeSlider = null;
        this.minPriceInput = document.getElementById('minPrice');
        this.maxPriceInput = document.getElementById('maxPrice');

        // State
        this.currentQuery = '';
        this.currentPage = 1;
        this.currentFilters = {};
        this.facetsData = {};
        this.suggestionTimeout = null;
        this.lastSearchTime = 0;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupPriceRangeSlider();
        this.initializeLanguage();
        this.loadInitialData();
        this.performInitialSearch();
    }

    initializeLanguage() {
        // Set English as default language
        document.getElementById('languageSelect').value = 'en';
        this.switchLanguage('en');
    }

    switchLanguage(lang) {
        // Update all elements with language data attributes
        document.querySelectorAll('[data-text-el][data-text-en]').forEach(element => {
            if (lang === 'el') {
                element.textContent = element.getAttribute('data-text-el');
            } else {
                element.textContent = element.getAttribute('data-text-en');
            }
        });

        // Update placeholders
        const searchInput = document.getElementById('mainSearch');
        if (lang === 'el') {
            searchInput.placeholder = searchInput.getAttribute('data-placeholder-el');
        } else {
            searchInput.placeholder = searchInput.getAttribute('data-placeholder-en');
        }

        // Update HTML lang attribute
        document.documentElement.lang = lang;
    }

    setupEventListeners() {
        // Search functionality
        this.searchInput.addEventListener('input', (e) => {
            this.handleSearchInput(e.target.value);
        });

        this.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performSearch();
            }
        });

        this.searchBtn.addEventListener('click', () => {
            this.performSearch();
        });

        // Suggestions dropdown
        this.searchInput.addEventListener('focus', () => {
            if (this.suggestionsDropdown.children.length > 0) {
                this.suggestionsDropdown.style.display = 'block';
            }
        });

        document.addEventListener('click', (e) => {
            if (!this.searchInput.contains(e.target) && !this.suggestionsDropdown.contains(e.target)) {
                this.suggestionsDropdown.style.display = 'none';
            }
        });

        // Filter functionality
        this.clearFiltersBtn.addEventListener('click', () => {
            this.clearAllFilters();
        });

        // Mobile filter controls
        this.mobileFilterBtn.addEventListener('click', () => {
            this.showMobileFilters();
        });

        this.filterBackdrop.addEventListener('click', () => {
            this.hideMobileFilters();
        });

        this.closeMobileFilters.addEventListener('click', () => {
            this.hideMobileFilters();
        });

        // Price range inputs
        this.minPriceInput.addEventListener('change', () => {
            this.updateFilters();
        });

        this.maxPriceInput.addEventListener('change', () => {
            this.updateFilters();
        });

        // Sort functionality
        document.getElementById('sortSelect').addEventListener('change', (e) => {
            this.currentFilters.sort = e.target.value;
            this.performSearch();
        });

        // Language selector
        document.getElementById('languageSelect').addEventListener('change', (e) => {
            this.switchLanguage(e.target.value);
        });

        // Availability filters
        document.getElementById('availableOnly').addEventListener('change', (e) => {
            if (e.target.checked) {
                this.currentFilters.availability = true;
            } else {
                delete this.currentFilters.availability;
            }
            this.updateFilters();
        });

        document.getElementById('inStock').addEventListener('change', (e) => {
            if (e.target.checked) {
                this.currentFilters.stock = true;
            } else {
                delete this.currentFilters.stock;
            }
            this.updateFilters();
        });
    }

    setupPriceRangeSlider() {
        const priceRangeSlider = document.getElementById('priceRangeSlider');

        noUiSlider.create(priceRangeSlider, {
            start: [0, 1000],
            connect: true,
            range: {
                'min': 0,
                'max': 1000
            },
            format: {
                to: (value) => Math.round(value),
                from: (value) => Number(value)
            }
        });

        this.priceRangeSlider = priceRangeSlider;

        // Update inputs when slider changes
        priceRangeSlider.noUiSlider.on('update', (values, handle) => {
            if (handle === 0) {
                this.minPriceInput.value = values[0];
            } else {
                this.maxPriceInput.value = values[1];
            }
        });

        // Update filters when slider changes
        priceRangeSlider.noUiSlider.on('change', (values) => {
            this.currentFilters.min_price = parseFloat(values[0]);
            this.currentFilters.max_price = parseFloat(values[1]);
            this.updateFilters();
        });
    }

    async loadInitialData() {
        try {
            // Load facets for filters
            await this.loadFacets();
        } catch (error) {
            console.error('Error loading initial data:', error);
        }
    }

    async performInitialSearch() {
        this.showLoading(true);
        await this.performSearch();
    }

    async handleSearchInput(query) {
        this.currentQuery = query;

        // Clear previous timeout
        if (this.suggestionTimeout) {
            clearTimeout(this.suggestionTimeout);
        }

        // Get suggestions with debouncing
        if (query.length >= 2) {
            this.suggestionTimeout = setTimeout(() => {
                this.getSuggestions(query);
            }, 300);
        } else {
            this.suggestionsDropdown.style.display = 'none';
        }
    }

    async getSuggestions(query) {
        try {
            const response = await fetch(`/suggestions?q=${encodeURIComponent(query)}&limit=8`);
            const suggestions = await response.json();

            this.displaySuggestions(suggestions);
        } catch (error) {
            console.error('Error getting suggestions:', error);
        }
    }

    displaySuggestions(suggestions) {
        if (suggestions.length === 0) {
            this.suggestionsDropdown.style.display = 'none';
            return;
        }

        this.suggestionsDropdown.innerHTML = suggestions.map(suggestion => `
            <div class="suggestion-item" onclick="app.selectSuggestion('${suggestion.replace(/'/g, "\\'")}')">
                <i class="fas fa-search suggestion-icon"></i>
                <span>${suggestion}</span>
            </div>
        `).join('');

        this.suggestionsDropdown.style.display = 'block';
    }

    selectSuggestion(suggestion) {
        this.searchInput.value = suggestion;
        this.currentQuery = suggestion;
        this.suggestionsDropdown.style.display = 'none';
        this.performSearch();
    }

    async performSearch(page = 1, searchType = 'all') {
        this.currentPage = page;
        this.showLoading(true);

        const startTime = Date.now();

        try {
            // Build query parameters
            const params = new URLSearchParams({
                page: page,
                per_page: 20,
                type: searchType
            });

            if (this.currentQuery) {
                params.append('q', this.currentQuery);
            }

            // Add filters
            Object.entries(this.currentFilters).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    params.append(key, value);
                }
            });

            // Perform search
            const response = await fetch(`/search?${params.toString()}`);
            const data = await response.json();

            const searchTime = Date.now() - startTime;
            this.lastSearchTime = searchTime;

            // Update UI
            this.displayUnifiedResults(data);
            this.updateSearchStats(data, searchTime);

            // Search categories if query exists
            if (this.currentQuery) {
                await this.searchCategories(this.currentQuery);
            } else {
                this.categoryResults.style.display = 'none';
            }

        } catch (error) {
            console.error('Search error:', error);
            this.showError('Σφάλμα κατά την αναζήτηση. Παρακαλώ δοκιμάστε ξανά.');
        } finally {
            this.showLoading(false);
        }
    }

    async searchCategories(query) {
        try {
            const response = await fetch(`/categories/search?q=${encodeURIComponent(query)}&limit=5`);
            const categories = await response.json();

            if (categories.length > 0) {
                this.displayCategoryResults(categories);
            } else {
                this.categoryResults.style.display = 'none';
            }
        } catch (error) {
            console.error('Category search error:', error);
            this.categoryResults.style.display = 'none';
        }
    }

    displayCategoryResults(categories) {
        this.categoryList.innerHTML = categories.map(category => `
            <div class="category-item" onclick="app.selectCategory('${category.name.replace(/'/g, "\\'")}')">
                <div class="category-name">${category.name}</div>
                <div class="category-count">${category.count} products</div>
            </div>
        `).join('');

        this.categoryResults.style.display = 'block';
    }

    selectCategory(categoryName) {
        this.currentFilters.category = categoryName;
        this.updateFilters();
        this.categoryResults.style.display = 'none';
    }

    displayResults(data) {
        const { products, total, page, per_page, total_pages } = data;

        // Update results count
        this.resultsCount.textContent = `${total.toLocaleString()} results`;
        this.resultsMeta.textContent = `Page ${page} of ${total_pages}`;

        if (products.length === 0) {
            this.showNoResults();
            return;
        }

        // Display products
        this.productGrid.innerHTML = products.map(product => this.createProductCard(product)).join('');

        // Update pagination
        this.updatePagination(page, total_pages);

        // Update facets
        if (data.facets) {
            this.updateFacets(data.facets);
        }

        // Show results
        this.noResults.style.display = 'none';
        this.productGrid.style.display = 'grid';
    }

    createProductCard(product) {
        const price = product.price ? `€${product.price.toFixed(2)}` : 'Not available';
        const originalPrice = product.original_price && product.original_price > product.price ? 
            `<span class="product-original-price">€${product.original_price.toFixed(2)}</span>` : '';

        const discount = product.original_price && product.original_price > product.price ?
            `<span class="product-discount">-${Math.round(((product.original_price - product.price) / product.original_price) * 100)}%</span>` : '';

        const availability = product.availability ? 
            '<span class="product-availability available">Available</span>' : 
            '<span class="product-availability unavailable">Not available</span>';

        const stockInfo = product.stock_quantity ? 
            `<div class="stock-info">Stock: ${product.stock_quantity}</div>` : '';

        const imageUrl = product.image_url || '';
        const imageContent = imageUrl ? 
            `<img src="${imageUrl}" alt="${product.title}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
             <div class="placeholder-icon" style="display: none;"><i class="fas fa-image"></i></div>` :
            `<div class="placeholder-icon"><i class="fas fa-image"></i></div>`;

        const brandName = product.brand ? product.brand.name : '';
        const categoryName = product.category ? product.category.name : '';
        const shopName = product.shop ? product.shop.name : '';

        return `
            <div class="product-card" onclick="app.showProductDetails(${product.id})">
                <div class="product-image">
                    ${imageContent}
                </div>
                <div class="product-info">
                    <div class="product-title">${product.title}</div>
                    <div class="product-price">
                        ${price}
                        ${originalPrice}
                        ${discount}
                    </div>
                    <div class="product-meta">
                        <div class="product-shop">${shopName}</div>
                        ${availability}
                    </div>
                    ${stockInfo}
                    ${brandName ? `<div class="text-muted small mt-1">${brandName}</div>` : ''}
                </div>
            </div>
        `;
    }

    updatePagination(currentPage, totalPages) {
        if (totalPages <= 1) {
            this.paginationContainer.style.display = 'none';
            return;
        }

        this.paginationContainer.style.display = 'flex';

        const pagination = document.createElement('nav');
        pagination.innerHTML = `
            <ul class="pagination">
                ${currentPage > 1 ? `<li class="page-item"><a class="page-link" href="#" onclick="app.performSearch(${currentPage - 1})">‹</a></li>` : ''}
                ${this.generatePaginationItems(currentPage, totalPages)}
                ${currentPage < totalPages ? `<li class="page-item"><a class="page-link" href="#" onclick="app.performSearch(${currentPage + 1})">›</a></li>` : ''}
            </ul>
        `;

        this.paginationContainer.innerHTML = '';
        this.paginationContainer.appendChild(pagination);
    }

    generatePaginationItems(currentPage, totalPages) {
        const items = [];
        const maxVisible = 5;

        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);

        if (endPage - startPage + 1 < maxVisible) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            const activeClass = i === currentPage ? 'active' : '';
            items.push(`<li class="page-item ${activeClass}"><a class="page-link" href="#" onclick="app.performSearch(${i})">${i}</a></li>`);
        }

        return items.join('');
    }

    updateSearchStats(data, searchTime) {
        const stats = `Found <span class="search-speed">${data.total.toLocaleString()}</span> results in <span class="search-speed">${searchTime}ms</span>`;
        this.searchStats.innerHTML = stats;
        this.searchStats.style.display = 'block';
    }

    async loadFacets() {
        try {
            const response = await fetch('/facets');
            const facets = await response.json();
            this.facetsData = facets;
            this.updateFacets(facets);
        } catch (error) {
            console.error('Error loading facets:', error);
        }
    }

    updateFacets(facets) {
        // Update brand filters
        if (facets.brands && facets.brands.length > 0) {
            this.brandFilters.innerHTML = facets.brands.slice(0, 10).map(brand => `
                <div class="filter-option">
                    <input type="checkbox" id="brand-${brand.key}" value="${brand.key}" 
                           ${this.currentFilters.brand === brand.key ? 'checked' : ''}
                           onchange="app.handleBrandFilter('${brand.key.replace(/'/g, "\\'")}', this.checked)">
                    <label for="brand-${brand.key}">${brand.key}</label>
                    <span class="filter-count">${brand.doc_count}</span>
                </div>
            `).join('');
        }

        // Update category filters
        if (facets.categories && facets.categories.length > 0) {
            this.categoryFilters.innerHTML = facets.categories.slice(0, 10).map(category => `
                <div class="filter-option">
                    <input type="checkbox" id="category-${category.key}" value="${category.key}"
                           ${this.currentFilters.category === category.key ? 'checked' : ''}
                           onchange="app.handleCategoryFilter('${category.key.replace(/'/g, "\\'")}', this.checked)">
                    <label for="category-${category.key}">${category.key}</label>
                    <span class="filter-count">${category.doc_count}</span>
                </div>
            `).join('');
        }

        // Update shop filters
        if (facets.shops && facets.shops.length > 0) {
            this.shopFilters.innerHTML = facets.shops.map(shop => `
                <div class="filter-option">
                    <input type="checkbox" id="shop-${shop.key}" value="${shop.key}"
                           ${this.currentFilters.shop === shop.key ? 'checked' : ''}
                           onchange="app.handleShopFilter('${shop.key.replace(/'/g, "\\'")}', this.checked)">
                    <label for="shop-${shop.key}">${shop.key}</label>
                    <span class="filter-count">${shop.doc_count}</span>
                </div>
            `).join('');
        }

        // Update price range slider
        if (facets.price_stats && facets.price_stats.min !== undefined) {
            const minPrice = Math.floor(facets.price_stats.min);
            const maxPrice = Math.ceil(facets.price_stats.max);

            this.priceRangeSlider.noUiSlider.updateOptions({
                range: {
                    'min': minPrice,
                    'max': maxPrice
                },
                start: [
                    this.currentFilters.min_price || minPrice,
                    this.currentFilters.max_price || maxPrice
                ]
            });
        }
    }

    handleBrandFilter(brand, checked) {
        if (checked) {
            this.currentFilters.brand = brand;
        } else {
            delete this.currentFilters.brand;
        }
        this.updateFilters();
    }

    handleCategoryFilter(category, checked) {
        if (checked) {
            this.currentFilters.category = category;
        } else {
            delete this.currentFilters.category;
        }
        this.updateFilters();
    }

    handleShopFilter(shop, checked) {
        if (checked) {
            this.currentFilters.shop = shop;
        } else {
            delete this.currentFilters.shop;
        }
        this.updateFilters();
    }

    updateFilters() {
        this.updateActiveFilters();
        this.performSearch();
    }

    updateActiveFilters() {
        const activeFilters = [];

        if (this.currentFilters.brand) {
            activeFilters.push({
                type: 'brand',
                value: this.currentFilters.brand,
                label: `Brand: ${this.currentFilters.brand}`
            });
        }

        if (this.currentFilters.category) {
            activeFilters.push({
                type: 'category',
                value: this.currentFilters.category,
                label: `Category: ${this.currentFilters.category}`
            });
        }

        if (this.currentFilters.shop) {
            activeFilters.push({
                type: 'shop',
                value: this.currentFilters.shop,
                label: `Shop: ${this.currentFilters.shop}`
            });
        }

        if (this.currentFilters.availability) {
            activeFilters.push({
                type: 'availability',
                value: this.currentFilters.availability,
                label: 'Available only'
            });
        }

        if (this.currentFilters.min_price || this.currentFilters.max_price) {
            const minPrice = this.currentFilters.min_price || 0;
            const maxPrice = this.currentFilters.max_price || '∞';
            activeFilters.push({
                type: 'price',
                value: 'price',
                label: `Price: €${minPrice} - €${maxPrice}`
            });
        }

        this.activeFilters.innerHTML = activeFilters.map(filter => `
            <div class="filter-tag">
                ${filter.label}
                <span class="remove" onclick="app.removeFilter('${filter.type}', '${filter.value}')">×</span>
            </div>
        `).join('');
    }

    removeFilter(type, value) {
        switch (type) {
            case 'brand':
                delete this.currentFilters.brand;
                break;
            case 'category':
                delete this.currentFilters.category;
                break;
            case 'shop':
                delete this.currentFilters.shop;
                break;
            case 'availability':
                delete this.currentFilters.availability;
                break;
            case 'price':
                delete this.currentFilters.min_price;
                delete this.currentFilters.max_price;
                break;
        }

        this.updateFilters();
    }

    clearAllFilters() {
        this.currentFilters = {};

        // Reset form elements
        document.querySelectorAll('.filter-option input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = false;
        });

        this.minPriceInput.value = '';
        this.maxPriceInput.value = '';

        // Reset price slider
        if (this.priceRangeSlider && this.facetsData.price_stats) {
            this.priceRangeSlider.noUiSlider.set([
                this.facetsData.price_stats.min,
                this.facetsData.price_stats.max
            ]);
        }

        this.updateFilters();
    }

    async showProductDetails(productId) {
        try {
            console.log('Show product details for:', productId);

            // Show modal with loading state
            const modal = new bootstrap.Modal(document.getElementById('productModal'));
            const modalBody = document.getElementById('productModalBody');

            modalBody.innerHTML = `
                <div class="text-center">
                    <div class="spinner-border" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="mt-2">Loading product details...</p>
                </div>
            `;

            modal.show();

            // Try to get product details from API
            let product = null;
            try {
                const response = await fetch(`/product/${productId}`);
                if (response.ok) {
                    product = await response.json();
                }
            } catch (error) {
                console.log('API endpoint not available, using search data');
            }

            // If API fails, find product in current search results
            if (!product) {
                const productCards = document.querySelectorAll('.product-card');
                let foundProduct = null;

                // Search through current results to find matching product
                const allProducts = Array.from(productCards).map(card => {
                    const title = card.querySelector('.product-title')?.textContent || '';
                    const price = card.querySelector('.product-price')?.textContent || '';
                    const availability = card.querySelector('.product-availability')?.textContent || '';
                    const shop = card.querySelector('.product-shop')?.textContent || '';
                    const image = card.querySelector('.product-image img')?.src || '';

                    return {
                        id: productId,
                        title,
                        price,
                        availability: availability.includes('Available'),
                        shop: shop,
                        image_url: image,
                        description: 'Product details from current search results'
                    };
                });

                product = allProducts[0]; // Use first product as fallback
            }

            // Display product details
            if (product) {
                this.displayProductModal(product);
            } else {
                modalBody.innerHTML = `
                    <div class="alert alert-warning">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        Product details not available
                    </div>
                `;
            }

        } catch (error) {
            console.error('Error showing product details:', error);
            document.getElementById('productModalBody').innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>
                    Error loading product details: ${error.message}
                </div>
            `;
        }
    }

    displayProductModal(product) {
        const modalBody = document.getElementById('productModalBody');
        const modalTitle = document.getElementById('productModalLabel');

        modalTitle.textContent = product.title || 'Product Details';

        const imageUrl = product.image_url && product.image_url !== 'https://via.placeholder.com/200x150?text=No+Image' 
            ? product.image_url 
            : null;

        const price = product.price ? 
            (typeof product.price === 'string' ? product.price : `€${product.price.toFixed(2)}`) 
            : 'Price not available';

        const originalPrice = product.original_price && product.original_price > parseFloat(product.price) ? 
            `<del class="text-muted ms-2">€${product.original_price.toFixed(2)}</del>` : '';

        const discount = product.original_price && product.original_price > parseFloat(product.price) ?
            `<span class="badge bg-warning text-dark ms-2">-${Math.round(((product.original_price - parseFloat(product.price)) / product.original_price) * 100)}%</span>` : '';

        const availability = product.availability || product.availability === true ? 
            '<span class="badge bg-success">Available</span>' : 
            '<span class="badge bg-danger">Out of Stock</span>';

        modalBody.innerHTML = `
            <div class="row">
                <div class="col-md-5">
                    ${imageUrl ? 
                        `<img src="${imageUrl}" class="img-fluid rounded" alt="${product.title}" style="width: 100%; max-height: 300px; object-fit: contain;">` :
                        `<div class="bg-light rounded d-flex align-items-center justify-content-center" style="height: 300px;">
                            <i class="fas fa-image fa-3x text-muted"></i>
                        </div>`
                    }
                </div>
                <div class="col-md-7">
                    <h5 class="mb-3">${product.title}</h5>

                    ${product.description ? `<p class="text-muted mb-3">${product.description}</p>` : ''}

                    <div class="mb-3">
                        <h4 class="text-primary mb-1">
                            ${price}
                            ${originalPrice}
                            ${discount}
                        </h4>
                    </div>

                    <div class="mb-3">
                        <strong>Availability:</strong> ${availability}
                    </div>

                    ${product.stock_quantity ? `
                        <div class="mb-3">
                            <strong>Stock:</strong> ${product.stock_quantity} units
                        </div>
                    ` : ''}

                    ${product.brand ? `
                        <div class="mb-3">
                            <strong>Brand:</strong> ${typeof product.brand === 'object' ? product.brand.name : product.brand}
                        </div>
                    ` : ''}

                    ${product.shop ? `
                        <div class="mb-3">
                            <strong>Shop:</strong> ${typeof product.shop === 'object' ? product.shop.name : product.shop}
                        </div>
                    ` : ''}

                    ${product.category ? `
                        <div class="mb-3">
                            <strong>Category:</strong> ${typeof product.category === 'object' ? product.category.name : product.category}
                        </div>
                    ` : ''}

                    ${product.ean ? `
                        <div class="mb-3">
                            <strong>EAN:</strong> ${product.ean}
                        </div>
                    ` : ''}

                    ${product.mpn ? `
                        <div class="mb-3">
                            <strong>MPN:</strong> ${product.mpn}
                        </div>
                    ` : ''}

                    ${product.product_url ? `
                        <div class="mt-4">
                            <a href="${product.product_url}" target="_blank" class="btn btn-primary">
                                <i class="fas fa-external-link-alt me-2"></i>
                                View on Store
                            </a>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    showMobileFilters() {
        this.filterSidebar.classList.add('show');
        this.filterBackdrop.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    hideMobileFilters() {
        this.filterSidebar.classList.remove('show');
        this.filterBackdrop.style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    showLoading(show) {
        if (show) {
            this.loadingSpinner.style.display = 'block';
            this.productGrid.style.display = 'none';
            this.noResults.style.display = 'none';
        } else {
            this.loadingSpinner.style.display = 'none';
        }
    }

    showNoResults() {
        this.noResults.style.display = 'block';
        this.productGrid.style.display = 'none';
        this.paginationContainer.style.display = 'none';
    }

    showError(message) {
        console.error(message);
        this.showLoading(false);
        this.resultsCount.textContent = 'Search error';
        this.resultsMeta.textContent = message;
        this.showNoResults();
    }

    displayUnifiedResults(data) {
        const resultsContainer = document.getElementById('resultsContainer');

        if (data.type === 'unified') {
            // Display both products and categories
            let html = '';

            if (data.categories && data.categories.length > 0) {
                html += '<div class="categories-section"><h3>Categories</h3><div class="categories-grid">';
                data.categories.forEach(category => {
                    html += `
                        <div class="category-card" onclick="app.searchInCategory('${category.name}')">
                            <h4>${category.name}</h4>
                            <p>${category.unique_products} unique products</p>
                            <small>${category.path || ''}</small>
                        </div>
                    `;
                });
                html += '</div></div>';
            }

            if (data.products && data.products.products && data.products.products.length > 0) {
                html += '<div class="products-section"><h3>Products</h3><div class="products-grid">';
                data.products.products.forEach(product => {
                    html += this.createAggregatedProductCard(product);
                });
                html += '</div></div>';
            }

            resultsContainer.innerHTML = html;
        } else {
            // Handle single type results
            this.displayResults(data);
        }
    }

    createAggregatedProductCard(product) {
        const availabilityText = product.availability ? 
            `Available in ${product.available_shops}/${product.shop_count} shops` :
            `Available in 3-7 days`;

        const priceText = product.best_available_price ? 
            `Best: €${product.best_available_price.toFixed(2)}` :
            `From: €${product.min_price?.toFixed(2) || 'N/A'}`;

        return `
            <div class="product-card aggregated" onclick="app.showProductDetails(${product.product_ids[0]})">
                <img src="${product.image_url || '/static/placeholder.jpg'}" alt="${product.title}" loading="lazy">
                <div class="product-info">
                    <h3 class="product-title">${product.title}</h3>
                    <p class="product-brand">${product.brand?.name || ''}</p>
                    <div class="price-info">
                        <span class="price">${priceText}</span>
                        ${product.min_price !== product.max_price ? 
                            `<span class="price-range">Range: €${product.min_price?.toFixed(2)} - €${product.max_price?.toFixed(2)}</span>` : ''
                        }
                    </div>
                    <div class="availability-info">
                        <span class="availability ${product.availability ? 'available' : 'limited'}">${availabilityText}</span>
                        <span class="shop-count">${product.shop_count} shops</span>
                    </div>
                    <div class="delivery-info">${product.availability_info.estimated_delivery}</div>
                </div>
            </div>
        `;
    }

    searchInCategory(categoryName) {
        this.currentFilters.category = categoryName;
        this.updateFilters();
        this.performSearch(1, 'products');
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ModernSearchApp();
});

// Prevent default form submission
document.addEventListener('click', (e) => {
    if (e.target.matches('a[href="#"]')) {
        e.preventDefault();
    }
});